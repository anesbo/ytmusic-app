import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  Lasso,
  Play,
  Power,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { AppLoader } from "./AppLoader";
import type { Track } from "../types";

interface StarNode {
  track: Track;
  x: number;
  y: number;
  radius: number;
  hue: number;
  sat: number;
  artistKey: string;
  liked: boolean;
}

interface GalaxyViewProps {
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: Track, list?: Track[]) => void;
  onDisable: () => void;
  onToast: (msg: string) => void;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const GalaxyView: React.FC<GalaxyViewProps> = ({
  currentTrackId,
  isPlaying,
  onPlayTrack,
  onDisable,
  onToast,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lassoMode, setLassoMode] = useState(false);
  const [hovered, setHovered] = useState<{ star: StarNode; sx: number; sy: number } | null>(null);
  const [flightPathIds, setFlightPathIds] = useState<string[]>([]);

  // Interactive camera & pointer refs (60 FPS smooth without React re-render lag)
  const camRef = useRef({ x: 0, y: 0, zoom: 1.0 });
  const panRef = useRef<{ active: boolean; startX: number; startY: number; camX: number; camY: number; moved: boolean }>({
    active: false,
    startX: 0,
    startY: 0,
    camX: 0,
    camY: 0,
    moved: false,
  });
  const lassoPtsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lassoDrawingRef = useRef(false);
  const bassEnergyRef = useRef(0);

  // Load tracks from all local/library sources
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getSmartPlaylist("most_played").catch(() => null),
      api.getLikedSongs().catch(() => null),
      api.getRecentHistory(120).catch(() => []),
      api.getDownloadedTracks().catch(() => []),
      api.getLocalLibraryTracks().catch(() => []),
    ])
      .then(([most, liked, recent, dl, local]) => {
        if (cancelled) return;
        const map = new Map<string, Track>();
        const ingest = (list?: Track[] | null, markLike = false) => {
          for (const t of list || []) {
            if (!t.videoId) continue;
            const prev = map.get(t.videoId);
            if (!prev) {
              map.set(t.videoId, markLike ? { ...t, likeStatus: "LIKE" } : t);
            } else if (markLike && prev.likeStatus !== "LIKE") {
              map.set(t.videoId, { ...prev, likeStatus: "LIKE" });
            }
          }
        };
        ingest(most?.tracks);
        ingest(liked?.tracks, true);
        ingest(recent);
        ingest(dl);
        ingest(local);
        setTracks(Array.from(map.values()).slice(0, 260));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen to live audio FFT bass energy for gentle pulsing of the active star
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onAudioSpectrum((bars) => {
        const bass = (bars[0] + bars[1] + bars[2] + bars[3]) / 4;
        bassEnergyRef.current = bassEnergyRef.current * 0.5 + bass * 0.5;
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Build deterministic artist-clustered constellation coordinates
  const stars = useMemo<StarNode[]>(() => {
    if (tracks.length === 0) return [];
    const byArtist = new Map<string, Track[]>();
    for (const t of tracks) {
      const key = (t.artist || "Unknown").trim().toLowerCase();
      const arr = byArtist.get(key) || [];
      arr.push(t);
      byArtist.set(key, arr);
    }

    const artists = Array.from(byArtist.entries()).sort((a, b) => b[1].length - a[1].length);
    const out: StarNode[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    artists.forEach(([artistKey, list], aIdx) => {
      const h = hashString(artistKey);
      const hue = h % 360;
      const clusterRadius = 48 + Math.sqrt(aIdx + 1) * 58;
      const clusterAngle = aIdx * goldenAngle + ((h % 100) / 100) * 0.35;
      const cx = Math.cos(clusterAngle) * clusterRadius;
      const cy = Math.sin(clusterAngle) * clusterRadius;

      list.forEach((track, tIdx) => {
        const th = hashString(track.videoId);
        const subAngle = tIdx * 2.15 + ((th % 360) * Math.PI) / 180;
        const subDist = list.length === 1 ? 0 : 14 + Math.sqrt(tIdx + 1) * 14;
        const liked = track.likeStatus === "LIKE";
        out.push({
          track,
          x: cx + Math.cos(subAngle) * subDist,
          y: cy + Math.sin(subAngle) * subDist,
          radius: liked ? 5.6 : 4.0,
          hue,
          sat: liked ? 82 : 58,
          artistKey,
          liked,
        });
      });
    });

    return out;
  }, [tracks]);

  // Precompute subtle constellation lines between songs by the same artist
  const edges = useMemo(() => {
    const map = new Map<string, StarNode[]>();
    for (const s of stars) {
      const arr = map.get(s.artistKey) || [];
      arr.push(s);
      map.set(s.artistKey, arr);
    }
    const pairs: Array<[StarNode, StarNode]> = [];
    map.forEach((group) => {
      for (let i = 0; i < group.length - 1; i++) {
        pairs.push([group[i], group[i + 1]]);
      }
    });
    return pairs;
  }, [stars]);

  // 60 FPS Canvas renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const bgDust = Array.from({ length: 130 }, (_, i) => ({
      x: ((hashString(`dx${i}`) % 10000) / 10000) * 2 - 1,
      y: ((hashString(`dy${i}`) % 10000) / 10000) * 2 - 1,
      r: 0.6 + ((hashString(`dr${i}`) % 100) / 100) * 1.1,
      a: 0.1 + ((hashString(`da${i}`) % 100) / 100) * 0.25,
    }));

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const qLower = search.trim().toLowerCase();
    const flightSet = new Set(flightPathIds);

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Deep space radial backdrop
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      grad.addColorStop(0, "rgba(22, 24, 38, 0.55)");
      grad.addColorStop(1, "rgba(6, 7, 12, 0.85)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const cam = camRef.current;
      const worldToScreen = (wx: number, wy: number) => ({
        x: w * 0.5 + (wx + cam.x) * cam.zoom,
        y: h * 0.5 + (wy + cam.y) * cam.zoom,
      });

      // Subtle parallax dust stars
      for (const d of bgDust) {
        const px = ((d.x * 0.5 + 0.5) * w + cam.x * 0.08 + w) % w;
        const py = ((d.y * 0.5 + 0.5) * h + cam.y * 0.08 + h) % h;
        const twinkle = 0.65 + 0.35 * Math.sin(time * 0.0014 + d.x * 12);
        ctx.fillStyle = `rgba(255, 255, 255, ${(d.a * twinkle).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Constellation edges (same artist)
      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        const pa = worldToScreen(a.x, a.y);
        const pb = worldToScreen(b.x, b.y);
        ctx.strokeStyle = `hsla(${a.hue}, ${a.sat}%, 68%, 0.14)`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Flight queue trajectory line (when lassoed or clicked!)
      if (flightPathIds.length > 1) {
        const starById = new Map(stars.map((s) => [s.track.videoId, s]));
        ctx.strokeStyle = "rgba(225, 29, 72, 0.55)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let started = false;
        for (const vid of flightPathIds) {
          const st = starById.get(vid);
          if (!st) continue;
          const p = worldToScreen(st.x, st.y);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw track stars
      const bass = isPlaying ? Math.max(bassEnergyRef.current, 0.25 + 0.18 * Math.sin(time * 0.005)) : 0;
      for (const s of stars) {
        const p = worldToScreen(s.x, s.y);
        if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;

        const isCurrent = s.track.videoId === currentTrackId;
        const isInFlight = flightSet.has(s.track.videoId);
        const matches =
          !qLower ||
          s.track.title.toLowerCase().includes(qLower) ||
          s.track.artist.toLowerCase().includes(qLower);

        const alpha = matches ? 1 : 0.14;
        const r = s.radius * Math.max(0.75, Math.min(1.5, Math.sqrt(cam.zoom)));

        if (isCurrent) {
          const pulseR = r * (2.6 + bass * 3.0);
          const glow = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, pulseR);
          glow.addColorStop(0, "rgba(244, 63, 94, 0.85)");
          glow.addColorStop(0.5, "rgba(244, 63, 94, 0.28)");
          glow.addColorStop(1, "rgba(244, 63, 94, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, pulseR, 0, Math.PI * 2);
          ctx.fill();
        } else if (matches && (s.liked || isInFlight)) {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
          glow.addColorStop(0, `hsla(${s.hue}, ${s.sat}%, 72%, 0.45)`);
          glow.addColorStop(1, `hsla(${s.hue}, ${s.sat}%, 72%, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isCurrent
          ? "#ffffff"
          : `hsla(${s.hue}, ${s.sat}%, ${s.liked ? 78 : 66}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isCurrent ? r * 1.25 : r, 0, Math.PI * 2);
        ctx.fill();

        // Show label when zoomed in or matched or playing
        if ((cam.zoom > 1.55 && matches) || isCurrent || (qLower && matches)) {
          ctx.font = isCurrent ? "600 11.5px Inter, system-ui, sans-serif" : "500 10.5px Inter, system-ui, sans-serif";
          ctx.fillStyle = isCurrent ? "#ffffff" : "rgba(244, 244, 245, 0.72)";
          ctx.fillText(s.track.title.slice(0, 26), p.x + r + 6, p.y + 3.5);
        }
      }

      // Draw active freehand lasso polygon
      const pts = lassoPtsRef.current;
      if (lassoDrawingRef.current && pts.length > 1) {
        ctx.fillStyle = "rgba(225, 29, 72, 0.12)";
        ctx.strokeStyle = "rgba(244, 63, 94, 0.85)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [stars, edges, currentTrackId, isPlaying, search, flightPathIds]);

  const hitTest = (clientX: number, clientY: number): { star: StarNode; sx: number; sy: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cam = camRef.current;
    let best: { star: StarNode; dist: number; sx: number; sy: number } | null = null;
    for (const s of stars) {
      const px = rect.width * 0.5 + (s.x + cam.x) * cam.zoom;
      const py = rect.height * 0.5 + (s.y + cam.y) * cam.zoom;
      const dist = Math.hypot(px - sx, py - sy);
      const hitR = Math.max(12, s.radius * Math.sqrt(cam.zoom) + 7);
      if (dist <= hitR && (!best || dist < best.dist)) {
        best = { star: s, dist, sx: px, sy: py };
      }
    }
    return best ? { star: best.star, sx: best.sx, sy: best.sy } : null;
  };

  const playFromStar = (target: StarNode) => {
    // Build a nearest-neighbor constellation flight queue starting from clicked star
    const ordered = [...stars]
      .sort((a, b) => {
        const da = Math.hypot(a.x - target.x, a.y - target.y);
        const db = Math.hypot(b.x - target.x, b.y - target.y);
        return da - db;
      })
      .slice(0, 20);
    const list = ordered.map((s) => s.track);
    setFlightPathIds(list.map((t) => t.videoId));
    onPlayTrack(target.track, list);
    onToast(`Constellation flight: ${target.track.title} + ${list.length - 1} nearby stars`);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (lassoMode) {
      lassoDrawingRef.current = true;
      lassoPtsRef.current = [{ x: sx, y: sy }];
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    panRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      camX: camRef.current.x,
      camY: camRef.current.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (lassoDrawingRef.current) {
      const pts = lassoPtsRef.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(sx - last.x, sy - last.y) > 5) {
        pts.push({ x: sx, y: sy });
      }
      return;
    }

    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      if (Math.hypot(dx, dy) > 4) panRef.current.moved = true;
      camRef.current.x = panRef.current.camX + dx / camRef.current.zoom;
      camRef.current.y = panRef.current.camY + dy / camRef.current.zoom;
      setHovered(null);
      return;
    }

    setHovered(hitTest(e.clientX, e.clientY));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (lassoDrawingRef.current) {
      lassoDrawingRef.current = false;
      const poly = lassoPtsRef.current;
      lassoPtsRef.current = [];
      if (poly.length >= 4) {
        const rect = e.currentTarget.getBoundingClientRect();
        const cam = camRef.current;
        const selected = stars.filter((s) => {
          const px = rect.width * 0.5 + (s.x + cam.x) * cam.zoom;
          const py = rect.height * 0.5 + (s.y + cam.y) * cam.zoom;
          return pointInPolygon(px, py, poly);
        });
        if (selected.length > 0) {
          const list = selected.map((s) => s.track);
          setFlightPathIds(list.map((t) => t.videoId));
          onPlayTrack(list[0], list);
          onToast(`Lassoed ${list.length} stars — playing your constellation!`);
        } else {
          onToast("No stars inside lasso — draw a loop around some stars");
        }
      }
      return;
    }

    const wasClick = panRef.current.active && !panRef.current.moved;
    panRef.current.active = false;
    if (wasClick) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) playFromStar(hit.star);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    camRef.current.zoom = Math.max(0.35, Math.min(3.5, camRef.current.zoom * factor));
  };

  return (
    <div className="galaxy-view-shell">
      <div className="galaxy-hud-top">
        <div>
          <div className="shelf-strapline" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Compass size={12} /> INTERACTIVE CONSTELLATION MAP
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Music Galaxy ({stars.length} stars)
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: 9, opacity: 0.55 }} />
            <input
              className="glass-input"
              style={{ paddingLeft: 29, width: 190, fontSize: 12.5, paddingTop: 6, paddingBottom: 6 }}
              placeholder="Highlight song or artist..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            className={`glass-pill ${lassoMode ? "active" : ""}`}
            onClick={() => {
              setLassoMode((m) => !m);
              onToast(!lassoMode ? "Lasso ON — draw a loop around stars to play them!" : "Pan & zoom mode");
            }}
            title="Draw a loop around any star cluster to play it as a queue"
          >
            <Lasso size={14} /> {lassoMode ? "Lasso active" : "Lasso select"}
          </button>

          <button
            className="glass-pill"
            onClick={() => {
              camRef.current = { x: 0, y: 0, zoom: 1.0 };
              setFlightPathIds([]);
            }}
            title="Reset camera zoom & flight path"
          >
            <RotateCcw size={14} /> Reset
          </button>

          <button
            className="glass-pill"
            onClick={onDisable}
            title="Disable and close Music Galaxy"
          >
            <Power size={14} /> Turn Off
          </button>
        </div>
      </div>

      <div ref={containerRef} className="galaxy-canvas-wrap glass-panel">
        {loading ? (
          <div className="galaxy-empty">
            <AppLoader size={22} /> Mapping your music constellation...
          </div>
        ) : stars.length === 0 ? (
          <div className="galaxy-empty">
            <Sparkles size={20} style={{ opacity: 0.6 }} />
            <span>Play or like a few songs first to populate your personal Music Galaxy.</span>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="galaxy-canvas"
              style={{ cursor: lassoMode ? "crosshair" : panRef.current.active ? "grabbing" : hovered ? "pointer" : "grab" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => {
                panRef.current.active = false;
                setHovered(null);
              }}
              onWheel={handleWheel}
            />

            {hovered && (
              <div
                className="galaxy-tooltip glass-panel"
                style={{
                  left: Math.min(hovered.sx + 14, (containerRef.current?.clientWidth || 600) - 245),
                  top: Math.max(12, hovered.sy - 34),
                }}
              >
                {hovered.star.track.thumbnail && (
                  <img src={hovered.star.track.thumbnail} alt="" className="galaxy-tooltip-art" />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 12.5 }}>{hovered.star.track.title}</div>
                  <div className="media-subtitle" style={{ fontSize: 11 }}>{hovered.star.track.artist}</div>
                </div>
                <Play size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
              </div>
            )}

            <div className="galaxy-legend">
              Drag to pan • Scroll to zoom • Click any star to launch a nearby flight • Toggle <strong>Lasso</strong> to circle a cluster
            </div>
          </>
        )}
      </div>
    </div>
  );
};

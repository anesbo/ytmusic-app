import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface HorizontalCarouselProps {
  children: React.ReactNode;
  autoScroll?: boolean;
  autoScrollSpeed?: number; // px per second
  className?: string;
}

export const HorizontalCarousel: React.FC<HorizontalCarouselProps> = ({
  children,
  autoScroll = false,
  autoScrollSpeed = 24,
  className = "",
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const hoveredRef = useRef(false);
  const pauseUntilRef = useRef(0);
  const inViewRef = useRef(true);
  const dirRef = useRef<1 | -1>(1);
  const subPxRef = useRef(0);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanLeft(el.scrollLeft > 4);
    setCanRight(maxScroll > 6 && el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    const onScroll = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [updateArrows, children]);

  // Track whether this carousel is in view so off-screen carousels use 0% CPU
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !autoScroll) return;
    const io = new IntersectionObserver(
      (entries) => {
        inViewRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoScroll]);

  // Gentle auto-scroll animation loop (pauses on hover, wheel, button click, off-screen, or tab hidden)
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollerRef.current;
    if (!el) return;

    let raf = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(64, Math.max(0, now - lastTs));
      lastTs = now;

      const maxScroll = el.scrollWidth - el.clientWidth;
      const eco = document.documentElement.classList.contains("eco-mode");
      if (
        maxScroll > 16 &&
        inViewRef.current &&
        !document.hidden &&
        !eco &&
        !hoveredRef.current &&
        now >= pauseUntilRef.current
      ) {
        subPxRef.current += (autoScrollSpeed * dt) / 1000 * dirRef.current;
        if (Math.abs(subPxRef.current) >= 1) {
          const whole = Math.trunc(subPxRef.current);
          subPxRef.current -= whole;
          el.scrollLeft += whole;

          if (el.scrollLeft >= maxScroll - 2) {
            dirRef.current = -1;
            pauseUntilRef.current = now + 1800;
          } else if (el.scrollLeft <= 1) {
            dirRef.current = 1;
            pauseUntilRef.current = now + 1800;
          }
        }
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll, autoScrollSpeed]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    pauseUntilRef.current = performance.now() + 4500;
    const stepPx = Math.max(240, Math.round(el.clientWidth * 0.78));
    el.scrollBy({ left: direction * stepPx, behavior: "smooth" });
  };

  return (
    <div
      className={`carousel-wrap ${canLeft ? "fade-left" : ""} ${canRight ? "fade-right" : ""}`}
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
    >
      {canLeft && (
        <button
          type="button"
          className="carousel-arrow-btn left"
          onClick={() => scrollByPage(-1)}
          aria-label="Scroll left"
          title="Scroll left"
        >
          <ChevronLeft size={18} />
        </button>
      )}

      <div
        ref={scrollerRef}
        className={`carousel-grid no-scrollbar ${className}`}
        onWheel={() => {
          pauseUntilRef.current = performance.now() + 3500;
        }}
      >
        {children}
      </div>

      {canRight && (
        <button
          type="button"
          className="carousel-arrow-btn right"
          onClick={() => scrollByPage(1)}
          aria-label="Scroll right"
          title="Scroll right"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
};

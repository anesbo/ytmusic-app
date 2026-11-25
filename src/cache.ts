import type {
  ArtistDetail,
  ExploreResponse,
  HomeResponse,
  PlaylistDetail,
  SearchResponse,
  Track,
} from "./types";

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes session cache for instant navigation

function getFresh<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setFresh<T>(map: Map<string, CacheEntry<T>>, key: string, value: T) {
  map.set(key, { value, ts: Date.now() });
}

const homeMap = new Map<string, CacheEntry<HomeResponse>>();
const exploreMap = new Map<string, CacheEntry<ExploreResponse>>();
const searchMap = new Map<string, CacheEntry<SearchResponse>>();
const playlistMap = new Map<string, CacheEntry<PlaylistDetail>>();
const artistMap = new Map<string, CacheEntry<ArtistDetail>>();
const recentMap = new Map<string, CacheEntry<Track[]>>();

export const pageCache = {
  getHome: (mood: string) => getFresh(homeMap, mood),
  setHome: (mood: string, v: HomeResponse) => setFresh(homeMap, mood, v),
  clearHome: () => homeMap.clear(),

  getExplore: () => getFresh(exploreMap, "default"),
  setExplore: (v: ExploreResponse) => setFresh(exploreMap, "default", v),
  clearExplore: () => exploreMap.clear(),

  getSearch: (query: string, filter: string) =>
    getFresh(searchMap, `${query.toLowerCase()}|${filter}`),
  setSearch: (query: string, filter: string, v: SearchResponse) =>
    setFresh(searchMap, `${query.toLowerCase()}|${filter}`, v),

  getPlaylist: (id: string) => getFresh(playlistMap, id),
  setPlaylist: (id: string, v: PlaylistDetail) => setFresh(playlistMap, id, v),
  invalidatePlaylist: (id: string) => playlistMap.delete(id),

  getArtist: (id: string) => getFresh(artistMap, id),
  setArtist: (id: string, v: ArtistDetail) => setFresh(artistMap, id, v),

  getRecent: () => getFresh(recentMap, "recent"),
  setRecent: (v: Track[]) => setFresh(recentMap, "recent", v),
  invalidateRecent: () => recentMap.delete("recent"),

  clearAll: () => {
    homeMap.clear();
    exploreMap.clear();
    searchMap.clear();
    playlistMap.clear();
    artistMap.clear();
    recentMap.clear();
  },
};

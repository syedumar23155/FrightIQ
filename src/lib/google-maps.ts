import { useEffect, useRef, useState } from "react";

export type GoogleMapMode = "hybrid" | "satellite" | "roadmap";
export type GoogleMapObject = {
  getZoom(): number | undefined;
  panTo(position: { lat: number; lng: number }): void;
  setCenter(position: { lat: number; lng: number }): void;
  setMapTypeId(mode: GoogleMapMode): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: unknown, padding?: number): void;
};
export type GoogleOverlay = { setMap(map: GoogleMapObject | null): void };
export type GoogleMapsApi = {
  maps: {
    Map: new (node: HTMLDivElement, options: Record<string, unknown>) => GoogleMapObject;
    LatLngBounds: new () => { extend(position: { lat: number; lng: number }): void };
    Polyline: new (options: Record<string, unknown>) => GoogleOverlay & {
      addListener(event: string, callback: () => void): void;
    };
    Marker: new (options: Record<string, unknown>) => GoogleOverlay & {
      addListener(event: string, callback: () => void): void;
    };
    SymbolPath: { CIRCLE: string; FORWARD_CLOSED_ARROW: string };
  };
};
type MapsWindow = Window & {
  google?: { maps?: { Map?: unknown } };
  gm_authFailure?: () => void;
  initFreightIqMap?: () => void;
};

let loading: Promise<GoogleMapsApi> | null = null;
export const GOOGLE_MAPS_AUTH_FAILURE = "freightiq-google-maps-auth-failure";

function reportMapFailure(reason: string) {
  window.dispatchEvent(new CustomEvent(GOOGLE_MAPS_AUTH_FAILURE, { detail: reason }));
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  const browser = window as MapsWindow;
  if (browser.google?.maps?.Map) return Promise.resolve(browser.google as GoogleMapsApi);
  if (loading) return loading;

  loading = new Promise<GoogleMapsApi>((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(new Error("Google Maps browser key is not configured"));
      return;
    }

    let settled = false;
    const timers: {
      poll?: ReturnType<typeof setInterval>;
      timeout?: ReturnType<typeof setTimeout>;
    } = {};
    const clearTimers = () => {
      if (timers.poll) clearInterval(timers.poll);
      if (timers.timeout) clearTimeout(timers.timeout);
    };
    const succeed = () => {
      if (settled || !browser.google?.maps?.Map) return;
      settled = true;
      clearTimers();
      resolve(browser.google as GoogleMapsApi);
    };
    const fail = (reason: string) => {
      reportMapFailure(reason);
      if (settled) return;
      settled = true;
      clearTimers();
      reject(new Error(reason));
    };

    const previousAuthFailure = browser.gm_authFailure;
    browser.gm_authFailure = () => {
      try {
        previousAuthFailure?.();
      } finally {
        fail("Google rejected the Maps key or its project authorization");
      }
    };
    const previousCallback = browser.initFreightIqMap;
    browser.initFreightIqMap = () => {
      try {
        previousCallback?.();
      } finally {
        succeed();
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-freightiq-map]");
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initFreightIqMap`;
      script.async = true;
      script.dataset["freightiqMap"] = "true";
      script.onerror = () => fail("Google Maps could not be downloaded");
      document.head.appendChild(script);
    }

    timers.poll = setInterval(succeed, 150);
    timers.timeout = setTimeout(
      () => fail("Google Maps did not become available. Check the key and network."),
      12000,
    );
    succeed();
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });

  return loading;
}

/** Creates a satellite map in the returned ref's element. */
export function useSatelliteMap(center: { lat: number; lng: number }, zoom: number) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<GoogleMapObject | null>(null);
  const [google, setGoogle] = useState<GoogleMapsApi | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const onAuthFailure = () => alive && setError(true);
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
    loadGoogleMaps()
      .then((g) => {
        if (!alive || !nodeRef.current) return;
        setGoogle(g);
        setMap(
          new g.maps.Map(nodeRef.current, {
            center,
            zoom,
            mapTypeId: "hybrid",
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
            clickableIcons: false,
          }),
        );
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { nodeRef, map, google, error };
}

export function cssToken(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

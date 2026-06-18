import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Mapa compacto de la ruta del día (D2): paradas numeradas en secuencia,
 * trazo del recorrido pendiente y posición del conductor. Los tiles OSM se
 * sirven cache-first desde el service worker y se pre-cachean al cargar la
 * ruta, así el mapa sobrevive zonas sin señal (donde Waze/Maps se quedan
 * en blanco). Sin imágenes de marcador: solo circleMarkers, cero assets.
 */

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  sequence: number;
  done: boolean;
  isPickup: boolean;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = "© OpenStreetMap";

export default function RouteMap({
  stops,
  geo,
}: {
  stops: MapStop[];
  geo: React.MutableRefObject<{ lat: number; lng: number } | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverMarkerRef = useRef<L.CircleMarker | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    // crossOrigin: las peticiones de tiles salen en modo CORS — sin esto el
    // service worker recibe respuestas opacas (response.ok === false) y los
    // tiles navegados JAMÁS entrarían al caché offline (D2).
    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
    map.setView([4.654, -74.084], 12); // Bogotá por defecto hasta tener paradas
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redibujar paradas/trazo SOLO cuando cambia la secuencia real (firma),
  // no por identidad del array: el fitBounds no debe robarle el encuadre al
  // conductor en cada refresco de 45 s.
  const drawnSignature = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const signature = stops
      .map((s) => `${s.id}:${s.sequence}:${s.done ? 1 : 0}`)
      .join("|");
    if (signature === drawnSignature.current) return;
    drawnSignature.current = signature;
    overlayRef.current?.remove();
    const overlay = L.layerGroup();
    overlayRef.current = overlay;

    const pending = stops.filter((s) => !s.done);
    if (pending.length > 1) {
      L.polyline(
        pending.map((s) => [s.lat, s.lng] as [number, number]),
        { color: "#233955", weight: 3, opacity: 0.7, dashArray: "6 6" },
      ).addTo(overlay);
    }
    for (const stop of stops) {
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 11,
        color: stop.done ? "#8a99a8" : stop.isPickup ? "#3a5169" : "#233955",
        fillColor: stop.done ? "#d6dade" : stop.isPickup ? "#eef2f5" : "#cfdd80",
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(overlay);
      marker.bindTooltip(String(stop.sequence), {
        permanent: true,
        direction: "center",
        className: "moveos-stop-label",
      });
    }
    overlay.addTo(map);

    const points = stops.map((s) => [s.lat, s.lng] as [number, number]);
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points).pad(0.2));
    }
  }, [stops]);

  // Posición del conductor: punto vivo refrescado cada 10 s desde el GPS.
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current;
      const pos = geo.current;
      if (!map || !pos) return;
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = L.circleMarker([pos.lat, pos.lng], {
          radius: 7,
          color: "#ffffff",
          fillColor: "#5a6b18",
          fillOpacity: 1,
          weight: 2,
        }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng([pos.lat, pos.lng]);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [geo]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Mapa de la ruta del día"
      className="h-52 w-full overflow-hidden rounded-xl shadow-sm"
    />
  );
}

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
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.setView([4.654, -74.084], 12); // Bogotá por defecto hasta tener paradas
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redibujar paradas/trazo cuando cambia la secuencia (re-secuenciación viva).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    overlayRef.current?.remove();
    const overlay = L.layerGroup();
    overlayRef.current = overlay;

    const pending = stops.filter((s) => !s.done);
    if (pending.length > 1) {
      L.polyline(
        pending.map((s) => [s.lat, s.lng] as [number, number]),
        { color: "#1b365d", weight: 3, opacity: 0.7, dashArray: "6 6" },
      ).addTo(overlay);
    }
    for (const stop of stops) {
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 11,
        color: stop.done ? "#94a3b8" : stop.isPickup ? "#0ea5e9" : "#1b365d",
        fillColor: stop.done ? "#cbd5e1" : stop.isPickup ? "#bae6fd" : "#c6d92e",
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
          fillColor: "#16a34a",
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

/**
 * Marca daleGo — isotipo y wordmark.
 *
 * El handoff no entrega vector oficial: el wordmark se compone
 * TIPOGRÁFICAMENTE en Gabarito Black y el isotipo » se dibuja. Por eso esto es
 * un componente y no un .svg estático (así hereda el color del tema y escala
 * con la tipografía en vez de pixelarse).
 *
 * Reglas del manual:
 *  - «daleGo» en aplicaciones de marca (sidebar, login); «DaleGo» en texto
 *    corrido. Nunca «dalego», «Dalego» ni «DALEGO».
 *  - Wordmark: caja baja con una única G mayúscula, Gabarito Black (900).
 *  - Isotipo: doble chevrón » con opacidad decreciente (100% / 55%).
 *  - Lockup de app: isotipo » verde + «daleGo», sin descriptor. El descriptor
 *    «ELECTROMOVILIDAD DE ÚLTIMA MILLA» va SOLO en el login.
 */

interface ChevronProps {
  /** Repeticiones del chevrón. El manual permite máximo 3. */
  count?: 1 | 2 | 3;
  /** Altura en px. Por defecto acompaña a un cuerpo de texto. */
  size?: number;
  className?: string;
}

/**
 * Isotipo »: chevrones con opacidad decreciente. `currentColor` para que
 * funcione sobre Asfalto y sobre Blanco Humo sin duplicar el componente.
 */
export function Chevron({ count = 2, size = 14, className }: ChevronProps) {
  // Geometría en una rejilla de 14 de alto; el ancho se deriva del conteo.
  const STEP = 6.5;
  const w = (count - 1) * STEP + 7;
  const shapes = Array.from({ length: count }, (_, i) => (
    <polygon
      key={i}
      points={`${i * STEP},0.5 ${i * STEP + 6},7 ${i * STEP},13.5`}
      fill="currentColor"
      opacity={i === 0 ? 1 : 0.55}
    />
  ));
  return (
    <svg
      viewBox={`0 0 ${w} 14`}
      height={size}
      width={(size * w) / 14}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {shapes}
    </svg>
  );
}

/**
 * Punto verde ●: cierra el tagline y las cifras clave, y marca el ítem activo
 * de la nav. Con `live` pulsa — reservado a datos en vivo.
 */
export function LuzVerde({
  size = 8,
  live,
  className,
}: {
  size?: number;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full bg-verde ${live ? "animate-livepulse" : ""} ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

interface WordmarkProps {
  /** Altura tipográfica del wordmark en px. */
  size?: number;
  /** Oculta el isotipo (para espacios muy estrechos). */
  withoutChevron?: boolean;
  className?: string;
}

/**
 * Lockup completo: » + daleGo. El chevrón va siempre en Verde Eléctrico; el
 * wordmark hereda el color del contenedor (Blanco Humo sobre oscuro, Asfalto
 * sobre claro).
 */
export function Wordmark({ size = 24, withoutChevron, className }: WordmarkProps) {
  return (
    <span
      className={`inline-flex items-baseline gap-2 ${className ?? ""}`}
      // El nombre accesible es el de marca; el resto es decorativo.
      role="img"
      aria-label="daleGo"
    >
      {!withoutChevron && (
        <Chevron
          count={2}
          size={Math.round(size * 0.62)}
          className="text-verde self-center"
        />
      )}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: `${size}px`,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        daleGo
      </span>
    </span>
  );
}

/** Descriptor institucional. Solo login y piezas de marca, nunca en producto. */
export function BrandDescriptor({ className }: { className?: string }) {
  return (
    <p
      className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary ${className ?? ""}`}
    >
      Electromovilidad de última milla
    </p>
  );
}

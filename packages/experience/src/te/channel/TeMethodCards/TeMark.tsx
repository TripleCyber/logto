/**
 * La marca de TripleEnable: tres barras ascendentes.
 *
 * Va como componente y no como `.svg?react` porque tiene que encajar en el tipo `SvgComponent`
 * que `VerificationMethodCard` espera, y porque `currentColor` la deja heredar el color del
 * texto: así se ve igual de bien en claro y en oscuro sin una segunda variante del archivo, que
 * es exactamente el problema que el logotipo de marca sí tiene hoy en el tema oscuro.
 */
const TeMark = ({ className }: { readonly className?: string }) => (
  <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="9" width="4" height="12" rx="1.5" fill="currentColor" />
    <rect x="10" y="4" width="4" height="17" rx="1.5" fill="currentColor" opacity="0.7" />
    <rect x="17" y="12" width="4" height="9" rx="1.5" fill="currentColor" opacity="0.45" />
  </svg>
);

export default TeMark;

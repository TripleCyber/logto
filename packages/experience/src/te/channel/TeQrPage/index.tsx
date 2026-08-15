import SecondaryPageLayout from '@/Layout/SecondaryPageLayout';
import ErrorPage from '@/pages/ErrorPage';

import TeQrPanel from '../TeQrPanel';
import useTeAvailability from '../use-te-availability';

/**
 * C1 · El QR en su propia pantalla de factor.
 *
 * Es a donde lleva el botón del conector en móvil, que es el único camino al QR ahí: en la
 * pantalla principal no se pinta, porque un QR en el móvil no se escanea con ese móvil. En
 * escritorio el botón del conector no existe —el código ya está pintado arriba— así que a esta
 * ruta sólo se llega escribiéndola, y entonces también funciona: no hay razón para romperla.
 *
 * Usa `SecondaryPageLayout`, el mismo contenedor que la pantalla de contraseña o la de código.
 * Eso trae gratis la barra de navegación con «atrás», el título, el `PageMeta` y el indicador de
 * progreso del alta — es decir, parece una pantalla de Logto porque lo es. La rama previa se
 * había construido un `TeLayout` propio para poder pasar cadenas planas en vez de claves de i18n;
 * con los textos en `phrases-experience` eso deja de hacer falta y sobra un componente.
 */
const TeQrPage = () => {
  const { hayQr, resuelto } = useTeAvailability();

  if (!resuelto) {
    return null;
  }

  // El canal está apagado, o el conector no está: la pantalla no existe.
  if (!hayQr) {
    return <ErrorPage title="error.invalid_session" />;
  }

  return (
    <SecondaryPageLayout description="te.qr.description" title="te.qr.title">
      <TeQrPanel />
    </SecondaryPageLayout>
  );
};

export default TeQrPage;

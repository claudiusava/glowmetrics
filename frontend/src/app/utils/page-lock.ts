// Bloquea el scroll de la página mientras hay un modal abierto. Devuelve la
// función que lo libera. Compensa el ancho de la barra de scroll para que la
// pantalla no "salte" al ocultarla.
export function lockPage(): () => void {
  const body = document.body;
  const previo = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  const barra = window.innerWidth - document.documentElement.clientWidth;
  if (barra > 0) body.style.paddingRight = `${barra}px`;
  body.style.overflow = 'hidden';
  return () => {
    body.style.overflow = previo.overflow;
    body.style.paddingRight = previo.paddingRight;
  };
}

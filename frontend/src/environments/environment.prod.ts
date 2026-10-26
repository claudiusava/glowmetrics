export const environment = {
  production: true,
  apiUrl: 'https://script.google.com/macros/s/AKfycbx5nfKqqui0DyJvdQCegL_XU3s9wEyxvt5MaKZDd0krEeYaMDrmXMWVNs08IR_y3kzv/exec',
  // El ranking mensual lo guarda una GitHub Action en el repositorio: se lee directamente de ahí,
  // así se actualiza sin tener que volver a publicar la web.
  rankingUrl: 'https://raw.githubusercontent.com/claudiusava/glowmetrics/main/ranking/data/latest.json',
};

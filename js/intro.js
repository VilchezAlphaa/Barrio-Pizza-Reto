(function () {
  var preloader = document.getElementById('brand-preloader');
  var hero = document.getElementById('brand-hero');
  var dashboard = document.getElementById('dashboard-app');
  var enterBtn = document.getElementById('brand-hero-btn');

  if (!preloader || !hero || !dashboard) return;

  document.documentElement.style.overflow = 'hidden';

  // 1) Preloader: se muestra el tiempo suficiente para que se vea la
  //    animación de texto completa, y luego pasa al hero con video.
  var PRELOADER_MS = 2100;

  setTimeout(function () {
    preloader.classList.add('is-hidden');
    hero.classList.add('is-visible');
  }, PRELOADER_MS);

  // Quitar el preloader del flujo (accesibilidad) una vez que termina la transición
  preloader.addEventListener('transitionend', function onDone(e) {
    if (e.propertyName === 'opacity') {
      preloader.style.display = 'none';
      preloader.removeEventListener('transitionend', onDone);
    }
  });

  // 2) Hero: al hacer clic en "Entrar a Barrio Compras" se revela el dashboard.
  enterBtn.addEventListener('click', function () {
    hero.classList.add('is-hidden');
    hero.classList.remove('is-visible');
    dashboard.classList.add('is-visible');
    document.documentElement.style.overflow = '';

    hero.addEventListener('transitionend', function onHeroDone(e) {
      if (e.propertyName === 'opacity') {
        hero.style.display = 'none';
        hero.removeEventListener('transitionend', onHeroDone);
      }
    });
  }, { once: true });
})();

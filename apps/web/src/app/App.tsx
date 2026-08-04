export function App() {
  return (
    <main className="app-shell">
      <section className="app-shell__content">
        <div className="foundation-card">
          <div className="foundation-card__badge">
            Fundación del proyecto
          </div>

          <h1 className="foundation-card__title">
            GanoBot
          </h1>

          <p className="foundation-card__description">
            Asistente inteligente contextual para Gano Sim Premium.
          </p>

          <div className="foundation-card__status">
            <span
              className="foundation-card__status-indicator"
              aria-hidden="true"
            />

            <span>
              Aplicación base configurada correctamente
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
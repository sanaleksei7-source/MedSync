export default function Home({ onStart }: { onStart: () => void }) {
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Добрый день, доктор</h1>
      <p className="text-slate-600">{today}</p>
      <p className="max-w-xl text-slate-700">
        MedSync слушает приём, расшифровывает разговор и готовит черновик документа. Каждый факт в документе
        привязан к реплике, из которой он взят.
      </p>
      <button onClick={onStart} className="rounded bg-teal-600 px-4 py-2 text-white hover:bg-teal-700">
        Начать демо-приём
      </button>
    </div>
  );
}

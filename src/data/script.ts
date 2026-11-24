export interface Line {
  id: number;
  speaker: "Врач" | "Пациент";
  text: string;
}

export interface Statement {
  text: string;
  /** Номера реплик, откуда взят факт. Пусто = не прозвучало в разговоре. */
  sourceIds: number[];
}

export interface Section {
  title: string;
  statements: Statement[];
}

// Врач проговаривает показатели вслух — в документе нет ничего, чего нет в репликах.
export const transcript: Line[] = [
  { id: 1, speaker: "Врач", text: "Добрый день. На что жалуетесь?" },
  { id: 2, speaker: "Пациент", text: "Третий день болит горло и кашляю." },
  { id: 3, speaker: "Врач", text: "Горло болит?" },
  { id: 4, speaker: "Пациент", text: "Да, боль в горле, особенно при глотании." },
  { id: 5, speaker: "Врач", text: "Кашель сухой или с мокротой?" },
  { id: 6, speaker: "Пациент", text: "Сухой." },
  { id: 7, speaker: "Врач", text: "Температуру дома мерили?" },
  { id: 8, speaker: "Пациент", text: "Вчера вечером было тридцать восемь и пять." },
  { id: 9, speaker: "Врач", text: "Сейчас измерим. Температура тридцать семь и восемь, пульс восемьдесят восемь ударов в минуту." },
  { id: 10, speaker: "Врач", text: "Смотрю горло: зев гиперемирован." },
  { id: 11, speaker: "Врач", text: "Состояние средней тяжести. Аллергия на лекарства есть?" },
  { id: 12, speaker: "Пациент", text: "Да, на пенициллин." },
  { id: 13, speaker: "Врач", text: "Назначаю полоскание раствором фурацилина и обильное питьё. Явка через пять дней." },
  { id: 14, speaker: "Врач", text: "Добавим амоксициллин, по 500 миллиграммов три раза в день." },
  { id: 15, speaker: "Врач", text: "Оформляю больничный лист на пять дней." },
  { id: 16, speaker: "Врач", text: "И направляю вас на общий анализ крови." },
];

export type DocType = "osmotr" | "bolnichny" | "napravlenie" | "spravka";

const diagnosis: Section = {
  // Намеренно без источника: врач диагноз вслух не называл, модель «додумала».
  title: "Диагноз",
  statements: [{ text: "ОРВИ, острый фарингит.", sourceIds: [] }],
};

export const docs: Record<DocType, { label: string; title: string; hint: string; sections: Section[] }> = {
  osmotr: {
    label: "Осмотр",
    title: "Протокол осмотра",
    hint: "Жалобы, анамнез, объективно, назначения",
    sections: [
      {
        title: "Жалобы",
        statements: [
          { text: "Боль в горле, усиливается при глотании, в течение трёх дней.", sourceIds: [2, 4] },
          { text: "Сухой кашель.", sourceIds: [2, 6] },
        ],
      },
      {
        title: "Анамнез",
        statements: [
          { text: "Подъём температуры до 38,5 °C накануне вечером (со слов пациента).", sourceIds: [8] },
          { text: "Аллергия на пенициллин.", sourceIds: [12] },
        ],
      },
      {
        title: "Объективно",
        statements: [
          { text: "Температура 37,8 °C.", sourceIds: [9] },
          { text: "ЧСС 88 уд/мин.", sourceIds: [9] },
          { text: "Зев гиперемирован.", sourceIds: [10] },
          { text: "Состояние средней тяжести.", sourceIds: [11] },
        ],
      },
      diagnosis,
      {
        title: "Назначения",
        statements: [
          { text: "Полоскание раствором фурацилина, обильное питьё.", sourceIds: [13] },
          { text: "Амоксициллин 500 мг 3 раза в день.", sourceIds: [14] },
          { text: "Повторная явка через 5 дней.", sourceIds: [13] },
        ],
      },
    ],
  },
  bolnichny: {
    label: "Больничный лист",
    title: "Листок нетрудоспособности",
    hint: "Диагноз, срок освобождения, режим",
    sections: [
      diagnosis,
      {
        title: "Освобождение от работы",
        statements: [{ text: "Срок нетрудоспособности: 5 дней.", sourceIds: [15] }],
      },
      {
        title: "Режим",
        statements: [
          { text: "Обильное питьё.", sourceIds: [13] },
          { text: "Повторная явка через 5 дней.", sourceIds: [13] },
        ],
      },
    ],
  },
  napravlenie: {
    label: "Направление",
    title: "Направление на анализ",
    hint: "Вид исследования и обоснование",
    sections: [
      {
        title: "Исследование",
        statements: [{ text: "Общий анализ крови.", sourceIds: [16] }],
      },
      {
        title: "Обоснование",
        statements: [
          { text: "Боль в горле и сухой кашель в течение трёх дней.", sourceIds: [2, 4, 6] },
          { text: "Температура 37,8 °C.", sourceIds: [9] },
          { text: "Аллергия на пенициллин.", sourceIds: [12] },
        ],
      },
      diagnosis,
    ],
  },
  spravka: {
    label: "Справка",
    title: "Справка о посещении врача",
    hint: "Обращение и рекомендации",
    sections: [
      {
        title: "Обращение",
        statements: [{ text: "Обратилась с жалобами на боль в горле и кашель.", sourceIds: [2, 4] }],
      },
      {
        title: "Рекомендации",
        statements: [{ text: "Полоскание раствором фурацилина, обильное питьё.", sourceIds: [13] }],
      },
    ],
  },
};

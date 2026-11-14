const PREFIX = 'mine-v1:';
let available = true;

export function read(name, fallback) {
  try {
    return JSON.parse(
      localStorage.getItem(PREFIX + name),
    ) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(name, value) {
  try {
    localStorage.setItem(
      PREFIX + name,
      JSON.stringify(value),
    );
    available = true;
  } catch {
    available = false;
  }

  return available;
}

export const storageAvailable = () => available;

export function saveGame(game) {
  const activeSaved = write('active', game);
  const records = read('records', []);
  const index = records.findIndex(item => item.id === game.id);

  if (index >= 0) {
    records[index] = game;
  } else {
    records.push(game);
  }

  const recordsSaved = write('records', records);
  available = activeSaved && recordsSaved;
}
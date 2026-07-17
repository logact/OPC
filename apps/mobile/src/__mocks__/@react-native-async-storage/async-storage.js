const storage = new Map();

export default {
  setItem: async (key, value) => {
    storage.set(key, value);
  },
  getItem: async (key) => storage.get(key) ?? null,
  removeItem: async (key) => {
    storage.delete(key);
  },
};

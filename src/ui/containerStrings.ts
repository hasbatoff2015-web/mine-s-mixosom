/** In-game container copy. The rest of GameUI is Russian-only; follow that policy. */
export const CONTAINER_STRINGS = Object.freeze({
  chest: 'Сундук',
  inventory: 'Инвентарь',
  catalog: 'Каталог',
  crafting: 'Создание',
  furnace: 'Печь',
  close: 'Закрыть',
  search: 'Поиск...',
  showAll: 'Все',
  showCraftable: 'Можно создать',
  recipeBook: 'Книга рецептов',
  all: 'Все',
  equipment: 'Снаряжение',
  building: 'Строительство',
  food: 'Еда',
  redstone: 'Редстоун',
  misc: 'Разное',
  foodFurnace: 'Еда',
  blocksFurnace: 'Блоки',
});

/** Overflow-contract labels. In-game copy stays Russian via CONTAINER_STRINGS. */
export const RECIPE_CATEGORY_LABELS_EN = Object.freeze({
  all: 'All',
  equipment: 'Equipment',
  building: 'Building',
  food: 'Food',
  redstone: 'Redstone',
  misc: 'Miscellaneous',
});

export type ContainerStringKey = keyof typeof CONTAINER_STRINGS;

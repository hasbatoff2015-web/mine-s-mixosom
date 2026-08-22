/** In-game container copy. The rest of GameUI is Russian-only; follow that policy. */
export const CONTAINER_STRINGS = Object.freeze({
  chest: 'Сундук',
  inventory: 'Инвентарь',
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

export type ContainerStringKey = keyof typeof CONTAINER_STRINGS;

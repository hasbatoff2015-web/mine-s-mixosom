import {
  RANK_LIMITS,
  formatDurationMs,
  formatRankExpiry,
  type DonationStatus,
  type EffectiveRank,
} from '../../shared/donationRanks';
import type { CosmeticPetSelection } from '../../src/entities/cosmeticPets';
import type { NetworkDonateAction, NetworkDonateKit, NetworkDonateMenu, NetworkDonatePerk, NetworkDonatePet } from '../../shared/protocol';
import { playerText } from '../../shared/playerText';

const RANK_LABEL: Record<EffectiveRank, string> = {
  default: 'Без привилегии',
  vip: 'VIP',
  premium: 'PREMIUM',
  boss: 'BOSS',
  titan: 'TITAN',
};

const KIT_LABELS: Record<string, string> = {
  start: 'Стартовый набор',
  vip: 'Набор VIP',
  food_vip: 'Еда VIP',
  prem: 'Набор PREMIUM',
  food_prem: 'Еда PREMIUM',
  boss: 'Набор BOSS',
  food_boss: 'Еда BOSS',
  titan: 'Набор TITAN',
  food_titan: 'Еда TITAN',
};

function again(remainingMs: number, ready: string): string {
  if (remainingMs > 0) return `Можно снова через ${formatDurationMs(remainingMs)}`;
  return ready;
}

export function buildDonateMenu(input: {
  readonly status: DonationStatus;
  readonly operator: boolean;
  readonly playerName: string;
  readonly homes: number;
  readonly claims: number;
  readonly auction: number;
  readonly onlinePlayers: readonly { playerId: string; name: string }[];
  readonly deathPoint?: { x: number; y: number; z: number };
  readonly summonedPet?: CosmeticPetSelection | null;
}): NetworkDonateMenu {
  const status = input.status;
  if (status.loadError) {
    return {
      rankLabel: 'Нет данных',
      summary: '',
      remainingLabel: status.loadError,
      loadError: status.loadError,
      perks: [],
      actions: [],
      kits: [],
      pets: [],
      catalog: [],
      nickChoices: [],
      previewName: input.playerName,
      onlinePlayers: [],
      showInvseeOp: false,
    };
  }
  const rank = status.rank;
  const limits = RANK_LIMITS[rank];
  const command = (id: string) => status.commands.find((entry) => entry.id === id);
  const nick = command('nickcolor');
  const announce = command('an');
  const invsee = command('invsee');
  const invseeOp = command('invseeop');
  const back = command('back-death');
  const tp = command('tp');
  const ec = command('ec');
  const petBee = command('pet-bee');
  const petCreeper = command('pet-creeper');
  const opNote = 'Без ограничений для OP';
  const perks: NetworkDonatePerk[] = [
    { title: 'Дома', detail: `${input.homes}/${status.limits.homes.max}` },
    { title: 'Приваты', detail: `${input.claims}/${status.limits.claims.max}` },
    { title: 'Лоты', detail: `${input.auction}/${status.limits.auction.max}` },
  ];
  const deathDetail = input.operator
    ? opNote
    : limits.deathBackPerDay === null
      ? 'Возврат к последней смерти'
      : again(back?.cooldownRemainingMs ?? 0, limits.deathBackPerDay === 1 ? '1 возврат в 24 часа' : `${limits.deathBackPerDay} возврата в 24 часа`);
  const actions: NetworkDonateAction[] = [
    {
      id: 'nickcolor',
      label: 'Цвет ника',
      screen: 'donate-color',
      available: nick?.available === true,
      active: nick?.available === true && Boolean(status.nick.color),
      detail: nick?.available
        ? (status.nick.color ? `Сейчас: ${status.nick.color}` : 'Изменить цвет своего имени')
        : 'Доступно с привилегии PREMIUM',
    },
    {
      id: 'announce',
      label: 'Объявление в чат',
      screen: 'donate-announce',
      available: announce?.available === true,
      detail: announce?.available
        ? (input.operator ? opNote : again(announce.cooldownRemainingMs, '1 объявление в 24 часа'))
        : 'Доступно с привилегии PREMIUM',
    },
    {
      id: 'invsee',
      label: 'Посмотреть чужой инвентарь',
      screen: 'donate-invsee',
      available: invsee?.available === true,
      detail: invsee?.available
        ? (input.operator ? opNote : again(invsee.cooldownRemainingMs, '1 просмотр в 24 часа'))
        : 'Доступно с привилегии TITAN',
    },
    {
      id: 'back',
      label: 'Вернуться в место последней смерти',
      screen: 'donate-back',
      available: back?.available === true,
      detail: back?.available
        ? (input.deathPoint ? deathDetail : 'Точка смерти не сохранена')
        : 'Эта функция доступна с привилегии BOSS.',
    },
    {
      id: 'tp',
      label: 'Телепорт по координатам',
      screen: 'donate-tp',
      available: tp?.available === true,
      detail: tp?.available
        ? (input.operator ? opNote : again(tp.cooldownRemainingMs, '1 успешный телепорт в 24 часа'))
        : 'Доступно с привилегии TITAN',
    },
    {
      id: 'ec',
      label: 'Портальный сундук',
      available: ec?.available === true,
      detail: ec?.available ? 'Открыть эндер-сундук' : 'Доступно с привилегии PREMIUM',
    },
    {
      id: 'kits',
      label: 'Наборы',
      screen: 'donate-kits',
      available: true,
      detail: 'Стартовые и ранговые наборы',
    },
    {
      id: 'pets',
      label: 'Питомцы',
      screen: 'donate-pets',
      available: true,
      active: input.summonedPet === 'bee' || input.summonedPet === 'creeper',
      detail: input.summonedPet === 'bee'
        ? 'Сейчас рядом: пчёлка'
        : input.summonedPet === 'creeper'
          ? 'Сейчас рядом: мини-крипер'
          : 'Пчёлка и мини-крипер',
    },
  ];
  if (invseeOp?.available) {
    actions.splice(3, 0, {
      id: 'invseeop',
      label: 'Изменить чужой инвентарь',
      screen: 'donate-invsee-op',
      available: true,
      detail: opNote,
    });
  }
  const petRow = (
    id: 'bee' | 'creeper',
    label: string,
    available: boolean,
    ready: string,
    denied: string,
    summon: string,
    dismiss: string,
  ): NetworkDonatePet => {
    const summoned = available && input.summonedPet === id;
    return {
      id,
      label,
      available,
      summoned,
      actionLabel: summoned ? dismiss : summon,
      detail: available ? (summoned ? playerText.petActive : ready) : denied,
    };
  };
  const pets: NetworkDonatePet[] = [
    petRow('bee', 'Пчёлка', petBee?.available === true, playerText.petBeeReady, playerText.petBeeDenied, playerText.petBeeSummon, playerText.petBeeDismiss),
    petRow('creeper', 'Мини-крипер', petCreeper?.available === true, playerText.petCreeperReady, playerText.petCreeperDenied, playerText.petCreeperSummon, playerText.petCreeperDismiss),
  ];
  const kits: NetworkDonateKit[] = status.kits.map((kit) => ({
    name: kit.name,
    label: KIT_LABELS[kit.name] ?? kit.name,
    available: kit.available,
    detail: kit.available
      ? (kit.once ? 'Один раз' : 'Можно получить')
      : (kit.cooldownRemainingMs > 0
        ? `Можно получить через ${formatDurationMs(kit.cooldownRemainingMs)}`
        : 'Уже получен'),
  }));
  const donateLabel = rank === 'default' ? '' : RANK_LABEL[rank];
  const rankLabel = input.operator
    ? (donateLabel ? `OP · ${donateLabel}` : 'OP')
    : RANK_LABEL[rank];
  const remainingLabel = status.expiresAt
    ? formatRankExpiry(status.expiresAt)
    : input.operator
      ? 'Права оператора не истекают'
      : 'Активной донат-привилегии нет';
  return {
    rankLabel,
    summary: '',
    remainingLabel,
    perks,
    actions,
    kits,
    pets,
    catalog: [],
    nickChoices: [...status.nick.choices],
    ...(status.nick.color ? { nickColor: status.nick.color } : {}),
    previewName: input.playerName,
    onlinePlayers: input.onlinePlayers,
    ...(input.deathPoint ? { deathPoint: input.deathPoint } : {}),
    showInvseeOp: invseeOp?.available === true,
  };
}

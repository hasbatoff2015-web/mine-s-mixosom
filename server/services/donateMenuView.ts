import {
  RANK_LIMITS,
  formatDurationMs,
  type DonationStatus,
  type EffectiveRank,
} from '../../shared/donationRanks';
import type { NetworkDonateAction, NetworkDonateKit, NetworkDonateMenu, NetworkDonatePerk } from '../../shared/protocol';

const RANK_LABEL: Record<EffectiveRank, string> = {
  default: 'Обычный игрок',
  vip: 'VIP',
  premium: 'PREMIUM',
  boss: 'BOSS',
  titan: 'TITAN',
};

const RANK_SUMMARY: Record<EffectiveRank, string> = {
  default: 'Активной донат-привилегии нет. Дома, приваты и лоты остаются в базовых лимитах.',
  vip: 'Префикс [VIP], наборы VIP и еды. Более высокие ранги добавляют команды.',
  premium: 'Всё от VIP, плюс портальный сундук, объявление в чат и цвет ника.',
  boss: 'Всё от PREMIUM, плюс возврат на место смерти раз в сутки.',
  titan: 'Всё от BOSS, плюс телепорт по координатам и просмотр чужого инвентаря.',
};

const CATALOG: NetworkDonatePerk[] = [
  { title: 'VIP', detail: 'Дома 4, приваты 4, лоты 10. Наборы VIP и еды. Префикс [VIP].' },
  { title: 'PREMIUM', detail: 'Дома 5, приваты 5, лоты 15. Сундук, объявление и цвет ника.' },
  { title: 'BOSS', detail: 'Дома 6, приваты 6, лоты 20. Возврат к смерти 1 раз в 24 часа.' },
  { title: 'TITAN', detail: 'Дома 7, приваты 7, лоты 25. /tp и просмотр инвентаря по 1 разу в 24 часа. Возврат к смерти 2 раза.' },
];

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

function cooldownDetail(remainingMs: number, fallback: string): string {
  if (remainingMs > 0) return `Следующее использование через ${formatDurationMs(remainingMs)}.`;
  return fallback;
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
}): NetworkDonateMenu {
  const status = input.status;
  if (status.loadError) {
    return {
      rankLabel: 'Нет данных',
      summary: status.loadError,
      remainingLabel: '',
      loadError: status.loadError,
      perks: [],
      actions: [],
      kits: [],
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
  const perks: NetworkDonatePerk[] = [
    { title: 'Дома', detail: `${input.homes}/${status.limits.homes.max}` },
    { title: 'Приваты', detail: `${input.claims}/${status.limits.claims.max}` },
    { title: 'Лоты аукциона', detail: `${input.auction}/${status.limits.auction.max}` },
    {
      title: 'Возврат к смерти',
      detail: input.operator || limits.deathBackPerDay === null
        ? 'Без донатного ограничения'
        : `${limits.deathBackPerDay} раз в 24 часа`,
    },
  ];
  if (rank !== 'default') {
    perks.push({ title: 'Префикс', detail: `[${RANK_LABEL[rank]}]` });
  }
  const actions: NetworkDonateAction[] = [
    {
      id: 'nickcolor',
      label: 'Цвет ника',
      screen: 'donate-color',
      available: nick?.available === true && (nick.cooldownRemainingMs ?? 0) <= 0,
      detail: nick?.available
        ? (status.nick.color ? `Сейчас: ${status.nick.color}` : 'Цвет ещё не выбран')
        : 'Доступно с привилегии PREMIUM.',
    },
    {
      id: 'announce',
      label: 'Объявление в чат',
      screen: 'donate-announce',
      available: announce?.available === true,
      detail: announce?.available
        ? cooldownDetail(announce.cooldownRemainingMs, '1 объявление в 24 часа. OP без ограничения.')
        : 'Доступно с привилегии PREMIUM.',
    },
    {
      id: 'invsee',
      label: 'Инвентарь игрока',
      screen: 'donate-invsee',
      available: invsee?.available === true,
      detail: invsee?.available
        ? cooldownDetail(invsee.cooldownRemainingMs, 'Только просмотр. 1 раз в 24 часа, OP без ограничения.')
        : 'Доступно с привилегии TITAN.',
    },
    {
      id: 'back',
      label: 'Вернуться на место смерти',
      screen: 'donate-back',
      available: back?.available === true,
      detail: input.deathPoint
        ? cooldownDetail(back?.cooldownRemainingMs ?? 0, `X ${Math.round(input.deathPoint.x)}  Y ${Math.round(input.deathPoint.y)}  Z ${Math.round(input.deathPoint.z)}`)
        : 'Точка смерти не сохранена.',
    },
    {
      id: 'tp',
      label: 'Телепорт по координатам',
      screen: 'donate-tp',
      available: tp?.available === true,
      detail: tp?.available
        ? cooldownDetail(tp.cooldownRemainingMs, '1 успешный /tp в 24 часа. OP без ограничения.')
        : 'Доступно с привилегии TITAN.',
    },
    {
      id: 'ec',
      label: 'Портальный сундук',
      available: ec?.available === true,
      detail: ec?.available ? 'Тот же сундук, что открывает /ec.' : 'Доступно с привилегии PREMIUM.',
    },
  ];
  if (invseeOp?.available) {
    actions.push({
      id: 'invseeop',
      label: 'Изменить инвентарь',
      screen: 'donate-invsee',
      available: true,
      detail: 'Только для OP. Обычный просмотр остаётся отдельным.',
    });
  }
  const kits: NetworkDonateKit[] = status.kits.map((kit) => ({
    name: kit.name,
    label: KIT_LABELS[kit.name] ?? kit.name,
    available: kit.available,
    detail: kit.available
      ? (kit.once ? 'Один раз.' : 'Можно получить.')
      : (kit.cooldownRemainingMs > 0
        ? `Через ${formatDurationMs(kit.cooldownRemainingMs)}.`
        : 'Уже получен.'),
  }));
  const until = status.expiresAt
    ? `Ещё ${formatDurationMs(status.remainingMs)}`
    : 'Без срока донат-ранга';
  return {
    rankLabel: input.operator ? 'OP' : RANK_LABEL[rank],
    summary: input.operator
      ? `Оператор. ${rank === 'default' ? 'Донат-ранга нет.' : `Донат-ранг ${RANK_LABEL[rank]}.`} ${RANK_SUMMARY[rank]}`
      : RANK_SUMMARY[rank],
    remainingLabel: input.operator && rank === 'default' ? 'Права оператора не истекают' : until,
    perks,
    actions,
    kits,
    catalog: rank === 'default' && !input.operator ? CATALOG : [],
    nickChoices: [...status.nick.choices],
    ...(status.nick.color ? { nickColor: status.nick.color } : {}),
    previewName: input.playerName,
    onlinePlayers: input.onlinePlayers,
    ...(input.deathPoint ? { deathPoint: input.deathPoint } : {}),
    showInvseeOp: invseeOp?.available === true,
  };
}

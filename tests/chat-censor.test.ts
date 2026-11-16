import { describe, expect, it } from 'vitest';
import { censorChatText } from '../server/services/chatCensor';
import { retainedChatDraft } from '../shared/chat';
import { pvpBadgeText } from '../shared/playerRules';

function stars(text: string): string {
  return '*'.repeat([...text].length);
}

describe('chat censor', () => {
  it('replaces russian and english profanity with the same number of stars', () => {
    expect(censorChatText('ты дебил')).toBe(`ты ${stars('дебил')}`);
    expect(censorChatText('это говно')).toBe(`это ${stars('говно')}`);
    expect(censorChatText('мудак и лох')).toBe(`${stars('мудак')} и ${stars('лох')}`);
    expect(censorChatText('what the fuck')).toBe(`what the ${stars('fuck')}`);
    expect(censorChatText('shit happens')).toBe(`${stars('shit')} happens`);
  });

  it('keeps punctuation and censors every banned word on its own', () => {
    expect(censorChatText('Пример, бля!')).toBe('Пример, ***!');
    expect(censorChatText('дебил, потом fuck.')).toBe(`${stars('дебил')}, потом ${stars('fuck')}.`);
    expect(censorChatText('  hello   world  ')).toBe('  hello   world  ');
  });

  it('treats case, repeats, separators, transliteration and lookalikes as the same word', () => {
    expect(censorChatText('ПИЗДЕЦ')).toBe(stars('ПИЗДЕЦ'));
    expect(censorChatText('пиииздец')).toBe(stars('пиииздец'));
    expect(censorChatText('п-и-з-д-е-ц')).toBe(stars('п-и-з-д-е-ц'));
    expect(censorChatText('пизд*ец')).toBe(stars('пизд*ец'));
    expect(censorChatText('п и з д е ц')).toBe('* * * * * *');
    expect(censorChatText('pizdec')).toBe(stars('pizdec'));
    expect(censorChatText('пuзда')).toBe(stars('пuзда'));
    expect(censorChatText(`пизд${'\u200b'}ец`)).toBe(stars(`пизд${'\u200b'}ец`));
    expect(censorChatText('FuCk')).toBe(stars('FuCk'));
    expect(censorChatText('f-u-c-k')).toBe(stars('f-u-c-k'));
    expect(censorChatText('sh1t')).toBe(stars('sh1t'));
    expect(censorChatText('дебилы')).toBe(stars('дебилы'));
    expect(censorChatText('нахуй')).toBe(stars('нахуй'));
    expect(censorChatText('пиздатый')).toBe(stars('пиздатый'));
    expect(censorChatText('заебал')).toBe(stars('заебал'));
    expect(censorChatText('сукно и лохматый пассажир')).toBe('сукно и лохматый пассажир');
  });

  it('does not censor ordinary words that merely share letters with a root', () => {
    for (const word of [
      'классный',
      'хлеб',
      'потреблять',
      'ребенок',
      'мандарин',
      'стекло',
      'команда',
      'страховка',
      'урок',
      'бляха',
      'cocktail',
      'assignment',
      'Scunthorpe',
      'classic',
      'hello',
      'shiitake',
      'peacock',
    ]) {
      expect(censorChatText(`смотри ${word} тут`)).toBe(`смотри ${word} тут`);
    }
  });

  it('keeps an exception even when the letters overlap a banned root', () => {
    expect(censorChatText('классический хлеб')).toBe('классический хлеб');
    expect(censorChatText('ребёнок ест хлеб')).toBe('ребёнок ест хлеб');
  });

  it('censors a multi-word phrase without touching the rest of the line', () => {
    expect(censorChatText('that blow job failed')).toBe(`that ${stars('blow')} ${stars('job')} failed`);
    expect(censorChatText('piece of cake')).toBe('piece of cake');
  });
});

describe('chat draft and pvp label', () => {
  it('keeps the rejected draft only while the composer is open and empty', () => {
    expect(retainedChatDraft('', 'привет', true)).toBe('привет');
    expect(retainedChatDraft('новое', 'привет', true)).toBeUndefined();
    expect(retainedChatDraft('', 'привет', false)).toBeUndefined();
    expect(retainedChatDraft('', '', true)).toBeUndefined();
  });

  it('formats the pvp badge with russian plural forms', () => {
    expect(pvpBadgeText(10)).toBe('Режим ПВП - 10 секунд');
    expect(pvpBadgeText(9)).toBe('Режим ПВП - 9 секунд');
    expect(pvpBadgeText(2)).toBe('Режим ПВП - 2 секунды');
    expect(pvpBadgeText(1)).toBe('Режим ПВП - 1 секунда');
  });
});

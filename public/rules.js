// 役(ラン/セット)判定 — サーバーとブラウザの両方で使う共通ロジック
// カード: { id, r }  r=1..8 は数字, r=0 はオールマイティ(ワイルド)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WILD = 0;
  const MAX_RANK = 8;

  // 与えられたカード群が成立する役の種類を返す ['set','run'] / [] (不成立)
  function comboTypes(cards) {
    if (!cards || cards.length === 0) return [];
    if (cards.length === 1) return ['set', 'run'];
    const nums = cards.filter(c => c.r !== WILD).map(c => c.r);
    const types = [];
    // セット: 数字がすべて同じ(ワイルドは何にでもなれる)
    if (nums.every(n => n === nums[0])) types.push('set');
    // ラン: 数字に重複なし、1〜8の範囲に収まり、すき間をワイルドで埋められる
    if (cards.length <= MAX_RANK) {
      const uniq = new Set(nums);
      if (uniq.size === nums.length) {
        if (nums.length === 0) types.push('run');
        else {
          const span = Math.max(...nums) - Math.min(...nums) + 1;
          if (span <= cards.length) types.push('run');
        }
      }
    }
    return types;
  }

  function isValidCombo(cards) {
    return comboTypes(cards).length > 0;
  }

  // 出せる枚数の範囲 (場が空なら1〜3, そうでなければ直前の場札の枚数±1)
  function allowedSizes(lastSize) {
    if (!lastSize) return { min: 1, max: 3 };
    return { min: Math.max(1, lastSize - 1), max: lastSize + 1 };
  }

  function canPlay(cards, lastSize) {
    const { min, max } = allowedSizes(lastSize);
    return cards.length >= min && cards.length <= max && isValidCombo(cards);
  }

  function canAdd(tableCards, card) {
    return isValidCombo(tableCards.concat([card]));
  }

  // 表示用: 役をそれっぽく並べる(ワイルドの位置を推定)
  function arrange(cards) {
    const nums = cards.filter(c => c.r !== WILD).sort((a, b) => a.r - b.r);
    const wilds = cards.filter(c => c.r === WILD);
    const types = comboTypes(cards);
    if (types.includes('run') && !types.includes('set') && nums.length) {
      const out = [];
      let w = wilds.slice();
      let need = nums[0].r;
      for (const c of nums) {
        while (need < c.r) { out.push(w.shift()); need++; }
        out.push(c); need++;
      }
      return out.concat(w);
    }
    return nums.concat(wilds);
  }

  return { WILD, MAX_RANK, comboTypes, isValidCombo, allowedSizes, canPlay, canAdd, arrange };
});

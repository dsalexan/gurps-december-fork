
const isArray = Array.isArray || function (value) { return value && typeof value === 'object' ? toString.call(value) === '[object Array]' : false }
function i18n_f(value, data, fallback) {
  let template = game.i18n.has(value) ? value : fallback
  if (!template) return value
  let result = game.i18n.format(template, data)
  if (!!fallback) return value === result ? fallback : result
  return result
}

export const MOVE_NONE = 'none'
export const MOVE_ONE = '1'
export const MOVE_STEP = 'step'
export const MOVE_ONETHIRD = '×1/3'
export const MOVE_HALF = 'half'
export const MOVE_TWOTHIRDS = '×2/3'
export const MOVE_FULL = 'full'

export class GURPSMove {
  constructor(name, label, icon, move, text) {
    this.name = name
    this.label = label
    this.icon = icon
    this.move = move
    this.text = text
  }
  
  serialize(move, threshold, reason, actor) {
    let _text = this.text || this.label
    if (!isArray(_text)) _text = [_text]
    const [textTemplate, textObject, textFallback] = _text

    return {
      type: this.name,
      name: this.name,
      label: this.label,
      icon: this.icon,
      move: this.move(move, threshold, actor),
      text: i18n_f(textTemplate, { ...textObject, reason: reason }, textFallback),
      text_minimal: i18n_f(textTemplate, { ...textObject }, textFallback).replace(' (undefined)', '').replace(' ()', '')
    }
  }
}

export const MOVES = {
  [MOVE_NONE]: new GURPSMove(MOVE_NONE, 
      'GURPS.moveNone', 
      'move_none', 
      () => 0,
    ),
  [MOVE_ONE]: new GURPSMove(MOVE_ONE, 
      'Constant', 
      'move_none', 
      () => 1, 
      ['GURPS.moveConstant', { value: 1, unit: 'meter' }, '1 {unit}/second']
    ),
  [MOVE_STEP]: new GURPSMove(MOVE_STEP, 
      'GURPS.moveStep', 
      'move_step', 
      (move, threshold, actor) => {
        // move ignoring reeling or tired
        const rawMove = parseInt(actor.getGurpsActorData().basicmove.value.toString())
        return Math.max(1, Math.ceil(rawMove / 10))
      },
    ),
  [MOVE_ONETHIRD]: new GURPSMove(MOVE_ONETHIRD, 
      'GURPS.moveOneThird', 
      'move_one_third', 
      (move, threshold) =>  Math.max(1, Math.ceil((move / 3) * threshold))
    ),
  [MOVE_HALF]: new GURPSMove(MOVE_HALF, 
      'GURPS.moveHalf', 
      'move_half', 
      (move, threshold) => Math.max(1, Math.ceil((move / 2) * threshold))
    ),
  [MOVE_TWOTHIRDS]: new GURPSMove(MOVE_TWOTHIRDS, 
      'GURPS.moveTwoThirds', 
      'move_two_thirds', 
      (move, threshold) => Math.max(1, Math.ceil(((2 * move) / 3) * threshold))
    ),
  [MOVE_FULL]: new GURPSMove(MOVE_FULL, 
      'GURPS.moveFull', 
      'move', 
      (move, threshold) => Math.max(1, Math.floor(move * threshold))
    ),
}
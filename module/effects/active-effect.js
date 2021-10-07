'use strict'

import Maneuvers, { MOVE_HALF, MOVE_NONE, MOVE_STEP, MOVE_FULL, PROPERTY_MOVEOVERRIDE } from '../actor/maneuver.js'

export default class GurpsActiveEffect extends ActiveEffect {
  static init() {
    CONFIG.ActiveEffect.documentClass = GurpsActiveEffect

    Hooks.on(
      'preCreateActiveEffect',
      async (
        /** @type {any} */ _effect,
        /** @type {{ duration: { combat: any; }; }} */ data,
        /** @type {any} */ _options,
        /** @type {any} */ _userId
      ) => {
        // Add combat id if necessary
        if (data.duration && !data.duration.combat && game.combat) data.duration.combat = game.combats?.active?.id
      }
    )

    Hooks.on(
      'createActiveEffect',
      async (/** @type {ActiveEffect} */ effect, /** @type {any} */ _data, /** @type {any} */ _userId) => {
        console.log('create ' + effect)
        if (effect.getFlag('gurps', 'requiresConfig') === true) {
          let dialog = new ActiveEffectConfig(effect)
          await dialog.render(true)
        }
      }
    )

    Hooks.on('applyActiveEffect', (actor, change, _options, _user) => {
      if (change.key === PROPERTY_MOVEOVERRIDE) actor._updateCurrentMoveOverride(change)
      if (change.key === 'data.conditions.maneuver') actor.replaceManeuver(change.value)
      else console.log(change)
    })

    // Hooks.on(
    //   'updateActiveEffect',
    //   (
    //     /** @type {ActiveEffect} */ effect,
    //     /** @type {any} */ _data,
    //     /** @type {any} */ _options,
    //     /** @type {any} */ _userId
    //   ) => {}
    // )

    Hooks.on(
      'deleteActiveEffect',
      (/** @type {string} */ effect, /** @type {any} */ _data, /** @type {any} */ _userId) => {
        console.log('delete ' + effect)
      }
    )

    Hooks.on(
      'updateCombat',
      (
        /** @type {Combat} */ combat,
        /** @type {any} */ _data,
        /** @type {any} */ _options,
        /** @type {any} */ _userId
      ) => {
        // get previous combatant { round: 6, turn: 0, combatantId: 'id', tokenId: 'id' }
        let previous = combat.previous
        if (previous.tokenId) {
          let token = canvas.tokens?.get(previous.tokenId)

          // go through all effects, removing those that have expired
          if (token && token.actor) {
            for (const effect of token.actor.effects) {
              let duration = effect.duration
              if (duration && !!duration.duration) {
                if (duration.remaining && duration.remaining <= 1) {
                  effect.delete()
                }
              }
            }
          }
        }
      }
    )
  }

  /**
   * @param {ActiveEffectData} data
   * @param {any} context
   */
  constructor(data, context) {
    super(data, context)

    this.context = context
  }

  get endCondition() {
    return this.getFlag('gurps', 'effect.endCondition')
  }

  get followup() {
    let data = /** @type {ActiveEffectData} */ (this.getFlag('gurps', 'effect.followup'))
    return new GurpsActiveEffect(data, this.context)
  }

  /**
   * @param {ActiveEffect} effect
   */
  static getName(effect) {
    return /** @type {string} */ (effect.getFlag('gurps', 'name'))
  }

  static async clearEffectsOnSelectedToken() {
    const effect = _token.actor.effects.contents
    for (let i = 0; i < effect.length; i++) {
      let condition = effect[i].data.label
      let status = effect[i].data.disabled
      let effect_id = effect[i].data._id
      console.log(`Clear Effect: condition: [${condition}] status: [${status}] effect_id: [${effect_id}]`)
      if (status === false) {
        await _token.actor.deleteEmbeddedDocuments('ActiveEffect', [effect_id])
      }
    }
  }
}

/*
  {
    key: fields.BLANK_STRING,
    value: fields.BLANK_STRING,
    mode: {
      type: Number,
      required: true,
      default: CONST.ACTIVE_EFFECT_MODES.ADD,
      validate: m => Object.values(CONST.ACTIVE_EFFECT_MODES).includes(m),
      validationError: "Invalid mode specified for change in ActiveEffectData"
      },
      priority: fields.NUMERIC_FIELD
    }
*/
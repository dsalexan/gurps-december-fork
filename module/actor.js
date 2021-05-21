'use strict'

import {
  extractP,
  xmlTextToJson,
  convertRollStringToArrayOfInt,
  recurselist,
  makeRegexPatternFrom,
  i18n,
  i18n_f,
} from '../lib/utilities.js'
import { parselink } from '../lib/parselink.js'
import { ResourceTrackerManager } from '../module/actor/resource-tracker-manager.js'
import ApplyDamageDialog from './damage/applydamage.js'
import * as HitLocations from '../module/hitlocation/hitlocation.js'
import * as settings from '../lib/miscellaneous-settings.js'

export class GurpsActor extends Actor {
  /** @override */
  getRollData() {
    const data = super.getRollData()
    return data
  }

  prepareData() {
    super.prepareData()
  }

  prepareDerivedData() {
    super.prepareDerivedData()
    this.calculateDerivedValues()
  }

  // execute after every import.
  async postImport() {
    for (const item of this.items.entries) await this.addItemData(item.data) // re-add the item equipment and features
    this.calculateDerivedValues()
    // Set custom trackers based on templates.  should be last because it may need other data to initialize...
    await this.setResourceTrackers()
  }

  // This will ensure that every characater at least starts with these new data values.  actor-sheet.js may change them.
  calculateDerivedValues() {
    this._initCurrents()
    this._calculateEncumbranceIssues()
    this._applyItemBonuses()
  }

  // Initialize the attribute current values/levels.   The code is expecting 'value' or 'level' for many things, and instead of changing all of the GUIs and OTF logic
  // we are just going to switch the rug out from underneath.   "Import" data will be in the 'import' key and then we will calculate value/level when the actor is loaded.
  // If import keys don't exist, set them to the current value and commit to upgrade older actors
  _initCurrents() {
    // Attributes need to have 'value' set because Foundry expects objs with value and max to be attributes (so we can't use currentvalue)
    let commit = {}
    for (const attr in this.data.data.attributes) {
      if (this.data.data.attributes[attr].import == null)
        commit = { ...commit, ...{ ['data.attributes.' + attr + '.import']: this.data.data.attributes[attr].value } }
      // backward compat
      else this.data.data.attributes[attr].value = this.data.data.attributes[attr].import
    }
    recurselist(this.data.data.skills, (e, k, d) => {
      if (e.import == null) commit = { ...commit, ...{ ['data.skills.' + k + '.import']: e.level } }
      else e.level = parseInt(e.import)
    })
    recurselist(this.data.data.spells, (e, k, d) => {
      if (e.import == null) commit = { ...commit, ...{ ['data.spells.' + k + '.import']: e.level } }
      else e.level = parseInt(e.import)
    })
    recurselist(this.data.data.melee, (e, k, d) => {
      if (e.import == null) commit = { ...commit, ...{ ['data.melee.' + k + '.import']: e.level } }
      else e.level = parseInt(e.import)
      if (!isNaN(parseInt(e.parry))) {
        // allows for '14f' and 'no'
        let base = 3 + Math.floor(e.level / 2)
        let bonus = parseInt(e.parry) - base
        if (bonus != 0) {
          e.parrybonus = (bonus > 0 ? '+' : '') + bonus
        }
      }
      if (!isNaN(e.block)) {
        let base = 3 + Math.floor(e.level / 2)
        let bonus = parseInt(e.block) - base
        if (bonus != 0) {
          e.blockbonus = (bonus > 0 ? '+' : '') + bonus
        }
      }
    })
    recurselist(this.data.data.ranged, (e, k, d) => {
      if (e.import == null) commit = { ...commit, ...{ ['data.ranged.' + k + '.import']: e.level } }
      else e.level = parseInt(e.import)
    })
    // We must delay the upgrade of older actor's 'import' keys, since upon startup, the actor may not know which collection it belongs to
    if (Object.keys(commit).length > 0) setTimeout(() => this.update(commit), 1000)
  }

  _applyItemBonuses() {
    let pi = n => (!!n ? parseInt(n) : 0)
    for (const item of this.items.entries) {
      if (item.data.data.equipped != false && !!item.data.data.bonuses) {
        let bonuses = item.data.data.bonuses.split('\n')
        for (const bonus of bonuses) {
          let action = parselink(bonus) // ATM, we only support attribute and skill
          if (!!action.action) {
            recurselist(this.data.data.melee, (e, k, d) => {
              e.level = pi(e.level)
              if (action.action.type == 'attribute') {
                // All melee attack skills affected by DX
                if (action.action.attrkey == 'DX') {
                  e.level += pi(action.action.mod)
                  if (!isNaN(parseInt(e.parry))) {
                    // handles '11f'
                    let m = (e.parry + '').match(/(\d+)(.*)/)
                    e.parry = 3 + Math.floor(e.level / 2)
                    if (!!e.parrybonus) e.parry += pi(e.parrybonus)
                    if (!!m) e.parry += m[2]
                  }
                  if (!isNaN(e.block)) {
                    // handles 'no'
                    e.block = 3 + Math.floor(e.level / 2)
                    if (!!e.blockbonus) e.block += pi(e.blockbonus)
                  }
                }
              }
              if (action.action.type == 'attack' && !!action.action.isMelee) {
                if (e.name.match(makeRegexPatternFrom(action.action.name, false))) e.level += pi(action.action.mod)
              }
            })
            recurselist(this.data.data.ranged, (e, k, d) => {
              e.level = pi(e.level)
              if (action.action.type == 'attribute') {
                //All ranged attack skills affected by DX
                if (action.action.attrkey == 'DX') e.level += pi(action.action.mod)
              }
              if (action.action.type == 'attack' && !!action.action.isRanged) {
                if (e.name.match(makeRegexPatternFrom(action.action.name, false))) e.level += pi(action.action.mod)
              }
            })
            recurselist(this.data.data.skills, (e, k, d) => {
              e.level = pi(e.level)
              if (action.action.type == 'attribute') {
                // skills affected by attribute changes
                if (e.relativelevel?.toUpperCase().startsWith(action.action.attrkey)) e.level += pi(action.action.mod)
              }
              if (action.action.type == 'skill-spell' && !action.action.isSpellOnly) {
                if (e.name.match(makeRegexPatternFrom(action.action.name, false))) e.level += pi(action.action.mod)
              }
            })
            recurselist(this.data.data.spells, (e, k, d) => {
              e.level = pi(e.level)
              if (action.action.type == 'attribute') {
                // spells affected by attribute changes
                if (e.relativelevel?.toUpperCase().startsWith(action.action.attrkey)) e.level += pi(action.action.mod)
              }
              if (action.action.type == 'skill-spell' && !action.action.isSkillOnly) {
                if (e.name.match(makeRegexPatternFrom(action.action.name, false))) e.level += pi(action.action.mod)
              }
            })
            if (action.action.type == 'attribute')
              this.data.data.attributes[action.action.attrkey].value =
                pi(this.data.data.attributes[action.action.attrkey].value) + pi(action.action.mod)
          }
          // parse bonus for other forms, DR+x?
        }
      }
    }
  }

  _calculateEncumbranceIssues() {
    const encs = this.data.data.encumbrance
    const isReeling = !!this.data.data.additionalresources.isReeling
    const isTired = !!this.data.data.additionalresources.isTired
    const initialSTvalue = this.data.data.attributes.ST.value
    this.data.data.attributes.ST.value = isTired ? Math.ceil(parseInt(initialSTvalue) / 2) : initialSTvalue
    // We must assume that the first level of encumbrance has the finally calculated move and dodge settings
    if (!!encs) {
      const level0 = encs[GURPS.genkey(0)] // if there are encumbrances, there will always be a level0
      let m = parseInt(level0.move)
      let d = parseInt(level0.dodge)
      let f = parseFloat(this.data.data.basicspeed.value) * 2
      if (isReeling) {
        m = Math.ceil(m / 2)
        d = Math.ceil(d / 2)
        f = Math.ceil(f / 2)
      }
      if (isTired) {
        m = Math.ceil(m / 2)
        d = Math.ceil(d / 2)
        f = Math.ceil(f / 2)
      }
      for (let enckey in encs) {
        let enc = encs[enckey]
        let t = 1.0 - 0.2 * parseInt(enc.level)
        enc.currentmove = Math.max(1, Math.floor(m * t))
        enc.currentdodge = Math.max(1, d - parseInt(enc.level))
        enc.currentflight = Math.max(1, Math.floor(f * t))
        enc.currentmovedisplay = enc.currentmove
        if (!!this.data.data.additionalresources.showflightmove)
          enc.currentmovedisplay = enc.currentmove + '/' + enc.currentflight
        if (enc.current) {
          // Save the global move/dodge
          this.data.data.currentmove = enc.currentmove
          this.data.data.currentdodge = enc.currentdodge
          this.data.data.currentflight = enc.currentflight
        }
      }
    }
    if (!this.data.data.equippedparry) this.data.data.equippedparry = this.getEquippedParry()
    if (!this.data.data.equippedblock) this.data.data.equippedblock = this.getEquippedBlock()
    // catch for older actors that may not have these values set
    if (!this.data.data.currentmove) this.data.data.currentmove = parseInt(this.data.data.basicmove.value)
    if (!this.data.data.currentdodge) this.data.data.currentdodge = parseInt(this.data.data.dodge.value)
    if (!this.data.data.currentflight) this.data.data.currentflight = parseFloat(this.data.data.basicspeed.value) * 2
  }

  /* Uncomment to see all of the data being 'updated' to this actor  DEBUGGING
  async update(data, options) {
    console.log(this.name + " UPDATE: "+ GURPS.objToString(data))
    await super.update(data, options)
  } */

  /** @override */
  _onUpdate(data, options, userId, context) {
    if (game.settings.get(settings.SYSTEM_NAME, settings.SETTING_AUTOMATIC_ONETHIRD)) {
      if (!isNaN(data.data?.HP?.value)) {
        let flag = data.data.HP.value < this.data.data.HP.max / 3
        if (!!this.data.data.additionalresources.isReeling != flag) this.changeOneThirdStatus('isReeling', flag)
      }
      if (!isNaN(data.data?.FP?.value)) {
        let flag = data.data.FP.value < this.data.data.FP.max / 3
        if (!!this.data.data.additionalresources.isTired != flag) this.changeOneThirdStatus('isTired', flag)
      }
    }
    //console.log(this.name + " _onUPDATE: "+ GURPS.objToString(data))
    super._onUpdate(data, options, userId, context)
    game.GURPS.ModifierBucket.refresh() // Update the bucket, in case the actor's status effects have changed
  }

  get _additionalResources() {
    return this.data.data.additionalresources
  }

  get displayname() {
    let n = this.name
    if (!!this.token && this.token.name != n) n = this.token.name + '(' + n + ')'
    return n
  }

  // First attempt at import GCS FG XML export data.
  async importFromGCSv1(xml, importname, importpath) {
    const GCAVersion = 'GCA-8'
    const GCSVersion = 'GCS-5'
    var c, ra // The character json, release attributes
    let isFoundryGCS = false
    let isFoundryGCA = false
    // need to remove <p> and replace </p> with newlines from "formatted text"
    let origx = game.GURPS.cleanUpP(xml)
    let x = xmlTextToJson(origx)
    let r = x.root
    let msg = []
    let version = 'unknown'
    let exit = false
    if (!r) {
      if (importname.endsWith('.gcs'))
        msg.push(
          i18n(
            'GURPS.chatCannotImportGCSDirectly',
            'We cannot import a GCS file directly. Please export the file using the "Foundry VTT" output template.'
          )
        )
      else if (importname.endsWith('.gca4'))
        msg.push(
          i18n(
            'GURPS.chatCannotImportGCADirectly',
            'We cannot import a GCA file directly. Please export the file using the "export to Foundry VTT.gce" script.'
          )
        )
      else if (!xml.startsWith('<?xml'))
        msg.push(i18n('GURPS.chatNoXMLDetected', 'No XML detected. Are you importing the correct XML file?'))
      exit = true
    } else {
      // The character object starts here
      c = r.character
      if (!c) {
        msg.push(
          i18n(
            'GURPS.chatNoCharacterFormat',
            'Unable to detect the "character" format. Most likely you are trying to import the "npc" format.'
          )
        )
        exit = true
      }

      let parsererror = r.parsererror
      if (!!parsererror) {
        msg.push(
          i18n_f(
            'GURPS.chatErrorParsingXML',
            { text: this.textFrom(parsererror.div) },
            'Error parsing XML: ' + this.textFrom(parsererror.div)
          )
        )
        exit = true
      }

      ra = r['@attributes']
      // Sorry for the horrible version checking... it sort of evolved organically
      isFoundryGCS = !!ra && ra.release == 'Foundry' && (ra.version == '1' || ra.version.startsWith('GCS'))
      isFoundryGCA = !!ra && ra.release == 'Foundry' && ra.version.startsWith('GCA')
      if (!(isFoundryGCS || isFoundryGCA)) {
        msg.push(i18n('GURPS.chatFantasyGroundUnsupported', 'We no longer support the Fantasy Grounds import.'))
        exit = true
      }
      version = ra?.version || ''
      const v = !!ra?.version ? ra.version.split('-') : []
      if (isFoundryGCA) {
        if (!v[1]) {
          msg.push(
            i18n(
              'GURPS.chatNoBodyPlan',
              'This file was created with an older version of the GCA Export which does not contain the "Body Plan" attribute. We will try to guess the "Body Plan", but we may get it wrong.'
            )
          )
        }
        let vernum = 1
        if (!!v[1]) vernum = parseInt(v[1])
        if (vernum < 2) {
          msg.push(
            i18n(
              'GURPS.chatNoInnateRangedAndParent',
              'This file was created with an older version of the GCA Export which does not export Innate Ranged attacks and does not contain the "Parent" Attribute for equipment.' +
                ' You may be missing ranged attacks or equipment may not appear in the correct container.'
            )
          )
        }
        if (vernum < 3) {
          msg.push(
            i18n(
              'GURPS.chatNoSanitizedEquipmentPageRefs',
              'This file was created with an older version of the GCA Export that may' +
                ' incorrectly put ranged attacks in the melee list and does not sanitize equipment page refs.'
            )
          ) // Equipment Page ref's sanitized
        }
        if (vernum < 4) {
          msg +=
            "This file was created with an older version of the GCA Export which does not contain the 'Parent' attributes for Ads/Disads, Skills or Spells<br>"
        }
        if (vernum < 5) {
          msg +=
            'This file was created with an older version of the GCA Export which does not sanitize Notes or Ad/Disad names<br>'
        }
        if (vernum < 6) {
          msg +=
            'This file was created with an older version of the GCA Export which may not export a melee attack if it also exists in ranged attacks (e.g. Spears)<br>'
        }
        if (vernum < 7) {
          msg +=
            'This file was created with an older version of the GCA Export which incorrectly calculates Block value for items with DB (e.g. Shields)<br>'
        }
        if (vernum < 8) {
          msg +=
            "This file was created with an older version of the GCA Export which ignored the 'hide' flag for ads/disads/quirks/perks<br>"
        }
      }
      if (isFoundryGCS) {
        let vernum = 1
        if (!!v[1]) vernum = parseInt(v[1])
        if (vernum < 2) {
          msg +=
            "This file was created with an older version of the GCS Export which does not contain the 'Parent' attributes.   Items will not appear in their containers.<br>"
        }
        if (vernum < 3) {
          msg +=
            'This file was created with an older version of the GCS Export which does not contain the Self Control rolls for Disadvantages (ex: [CR: 9 Bad Temper]).<br>'
        }
        if (vernum < 4) {
          msg +=
            "This file was created with an older version of the GCS Export which does not contain the 'Uses' column for Equipment.<br>"
        }
        if (vernum < 5) {
          msg +=
            'This file was created with an older version of the GCS Export which does not export individual Melee and Ranged attack notes created by the same item.<br>'
        }
      }
    }
    if (!!msg) {
      ui.notifications.error(msg)
      msg = `WARNING:<br>${msg}<br>The file version: '${version}'<br>Current Versions: '${GCAVersion}' & '${GCSVersion}'`
      ChatMessage.create({
        content:
          msg +
          "<br>Check the Users Guide for details on where to get the latest version.<br><a href='" +
          GURPS.USER_GUIDE_URL +
          "'>GURPS 4e Game Aid USERS GUIDE</a>",
        user: game.user._id,
        type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
        whisper: [game.user.id],
      })
      if (exit) return // Some errors cannot be forgiven ;-)
    }
    let nm = this.textFrom(c.name)
    console.log("Importing '" + nm + "'")
    // this is how you have to update the domain object so that it is synchronized.

    let commit = {}

    if (!game.settings.get(settings.SYSTEM_NAME, settings.SETTING_IGNORE_IMPORT_NAME)) {
      commit = { ...commit, ...{ name: nm } }
      commit = { ...commit, ...{ 'token.name': nm } }
    }
    commit = { ...commit, ...{ 'data.lastImport': new Date().toString().split(' ').splice(1, 4).join(' ') } }
    let ar = this.data.data.additionalresources || {}
    ar.importname = importname || ar.importnam
    ar.importpath = importpath || ar.importpath
    ar.importversion = ra.version
    commit = { ...commit, ...{ 'data.additionalresources': ar } }

    try {
      // This is going to get ugly, so break out various data into different methods
      commit = { ...commit, ...(await this.importAttributesFromCGSv1(c.attributes)) }
      commit = { ...commit, ...this.importSkillsFromGCSv1(c.abilities?.skilllist, isFoundryGCS) }
      commit = { ...commit, ...this.importTraitsfromGCSv1(c.traits) }
      commit = { ...commit, ...this.importCombatMeleeFromGCSv1(c.combat?.meleecombatlist, isFoundryGCS) }
      commit = { ...commit, ...this.importCombatRangedFromGCSv1(c.combat?.rangedcombatlist, isFoundryGCS) }
      commit = { ...commit, ...this.importSpellsFromGCSv1(c.abilities?.spelllist, isFoundryGCS) }
      if (isFoundryGCS) {
        commit = { ...commit, ...this.importAdsFromGCSv2(c.traits?.adslist) }
        commit = { ...commit, ...this.importReactionsFromGCSv2(c.reactions) }
      }
      if (isFoundryGCA) {
        commit = { ...commit, ...this.importAdsFromGCA(c.traits?.adslist, c.traits?.disadslist) }
        commit = { ...commit, ...this.importReactionsFromGCA(c.traits?.reactionmodifiers) }
      }
      commit = { ...commit, ...this.importEncumbranceFromGCSv1(c.encumbrance) }
      commit = { ...commit, ...this.importPointTotalsFromGCSv1(c.pointtotals) }
      commit = { ...commit, ...this.importNotesFromGCSv1(c.description, c.notelist) }
      commit = { ...commit, ...this.importEquipmentFromGCSv1(c.inventorylist, isFoundryGCS) }
      commit = { ...commit, ...(await this.importProtectionFromGCSv1(c.combat?.protectionlist, isFoundryGCA)) }
    } catch (err) {
      let msg = 'An error occured while importing ' + nm + ', ' + err.name + ':' + err.message
      ui.notifications.warn(msg)
      let chatData = {
        user: game.user._id,
        type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
        content: msg,
        whisper: [game.user._id],
      }
      CONFIG.ChatMessage.entityClass.create(chatData, {})
      // Don't return, because we want to see how much actually gets committed.
    }
    console.log('Starting commit')

    let deletes = Object.fromEntries(Object.entries(commit).filter(([key, value]) => key.includes('.-=')))
    let adds = Object.fromEntries(Object.entries(commit).filter(([key, value]) => !key.includes('.-=')))

    try {
      await this.update(deletes)
      await this.update(adds)
      // This has to be done after everything is loaded
      await this.postImport()
      console.log('Done importing.  You can inspect the character data below:')
      console.log(this)
    } catch (err) {
      let msg = 'An error occured while importing ' + nm + ', ' + err.name + ':' + err.message
      if (err.message == 'Maximum depth exceeded')
        msg =
          'You have too many levels of containers.  The Foundry import only supports up to 3 levels of sub-containers'
      ui.notifications.warn(msg)
      let chatData = {
        user: game.user._id,
        type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
        content: msg,
        whisper: [game.user._id],
      }
      CONFIG.ChatMessage.entityClass.create(chatData, {})
    }
  }

  // hack to get to private text element created by xml->json method.
  textFrom(o) {
    if (!o) return ''
    let t = o['#text']
    if (!t) return ''
    return t.trim()
  }

  // similar hack to get text as integer.
  intFrom(o) {
    if (!o) return 0
    let i = o['#text']
    if (!i) return 0
    return parseInt(i)
  }

  floatFrom(o) {
    if (!o) return 0
    let f = o['#text']
    if (!f) return 0
    return parseFloat(f)
  }

  importReactionsFromGCSv2(json) {
    if (!json) return
    let t = this.textFrom
    let rs = {}
    let index = 0
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let r = new Reaction()
        r.modifier = t(j.modifier)
        r.situation = t(j.situation)
        game.GURPS.put(rs, r, index++)
      }
    }
    return {
      'data.-=reactions': null,
      'data.reactions': rs,
    }
  }

  importReactionsFromGCA(json) {
    if (!json) return
    let text = this.textFrom(json)
    let a = text.split(',')
    let rs = {}
    let index = 0
    a.forEach(m => {
      if (!!m) {
        let t = m.trim()
        let i = t.indexOf(' ')
        let mod = t.substring(0, i)
        let sit = t.substr(i + 1)
        let r = new Reaction(mod, sit)
        game.GURPS.put(rs, r, index++)
      }
    })
    return {
      'data.-=reactions': null,
      'data.reactions': rs,
    }
  }

  importPointTotalsFromGCSv1(json) {
    if (!json) return

    let i = this.intFrom
    return {
      'data.totalpoints.attributes': i(json.attributes),
      'data.totalpoints.ads': i(json.ads),
      'data.totalpoints.disads': i(json.disads),
      'data.totalpoints.quirks': i(json.quirks),
      'data.totalpoints.skills': i(json.skills),
      'data.totalpoints.spells': i(json.spells),
      'data.totalpoints.unspent': i(json.unspentpoints),
      'data.totalpoints.total': i(json.totalpoints),
      'data.totalpoints.race': i(json.race),
    }
  }

  importNotesFromGCSv1(descjson, json) {
    if (!json) return
    let t = this.textFrom
    let temp = []
    if (!!descjson) {
      // support for GCA description
      let n = new Note()
      n.notes = t(descjson).replace(/\\r/g, '\n')
      n.imported = true
      temp.push(n)
    }
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let n = new Note()
        //n.setNotes(t(j.text));
        n.notes = t(j.name)
        let txt = t(j.text)
        if (!!txt) n.notes = n.notes + '\n' + txt.replace(/\\r/g, '\n')
        n.uuid = t(j.uuid)
        n.parentuuid = t(j.parentuuid)
        n.pageref = t(j.pageref)
        temp.push(n)
      }
    }
    // Save the old User Entered Notes.
    recurselist(this.data.data.notes, t => {
      if (!!t.save) temp.push(t)
    })
    return {
      'data.-=notes': null,
      'data.notes': this.foldList(temp),
    }
  }

  async importProtectionFromGCSv1(json, isFoundryGCA) {
    if (!json) return
    let t = this.textFrom
    let data = this.data.data
    if (!!data.additionalresources.ignoreinputbodyplan) return
    let locations = []
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let hl = new HitLocations.HitLocation(t(j.location))
        hl.dr = t(j.dr)
        hl.penalty = t(j.db)
        hl.setEquipment(t(j.text))

        // Some hit location tables have two entries for the same location. The code requires
        // each location to be unique. Append an asterisk to the location name in that case.   Hexapods and ichthyoid
        while (locations.filter(it => it.where == hl.where).length > 0) {
          hl.where = hl.where + '*'
        }
        locations.push(hl)
      }
    }

    // Do the results contain vitals? If not, add it.
    let vitals = locations.filter(value => value.where === HitLocations.HitLocation.VITALS)
    if (vitals.length === 0) {
      let hl = new HitLocations.HitLocation(HitLocations.HitLocation.VITALS)
      hl.penalty = HitLocations.hitlocationRolls[HitLocations.HitLocation.VITALS].penalty
      hl.roll = HitLocations.hitlocationRolls[HitLocations.HitLocation.VITALS].roll
      hl.dr = '0'
      locations.push(hl)
    }

    // Hit Locations MUST come from an existing bodyplan hit location table, or else ADD (and
    // potentially other features) will not work. Sometime in the future, we will look at
    // user-entered hit locations.
    let bodyplan = t(json.bodyplan)?.toLowerCase() // Was a body plan actually in the import?
    if (bodyplan === 'snakemen') bodyplan = 'snakeman'
    let table = HitLocations.hitlocationDictionary[bodyplan] // If so, try to use it.
    let locs = []
    locations.forEach(e => {
      if (!!table && !!table[e.where]) {
        // if e.where already exists in table, don't map
        locs.push(e)
      } else {
        // map to new name(s) ... sometimes we map 'Legs' to ['Right Leg', 'Left Leg'], for example.
        e.locations(false).forEach(l => locs.push(l)) // Map to new names
      }
    })
    locations = locs

    if (!table) {
      locs = []
      locations.forEach(e => {
        e.locations(true).forEach(l => locs.push(l)) // Map to new names, but include original to help match against tables
      })
      bodyplan = this._getBodyPlan(locs)
      table = HitLocations.hitlocationDictionary[bodyplan]
    }
    // update location's roll and penalty based on the bodyplan

    if (!!table) {
      Object.values(locations).forEach(it => {
        let [lbl, entry] = HitLocations.HitLocation.findTableEntry(table, it.where)
        if (!!entry) {
          it.where = lbl // It might be renamed (ex: Skull -> Brain)
          if (!it.penalty) it.penalty = entry.penalty
          if (!it.roll || it.roll.length === 0 || it.roll === HitLocations.HitLocation.DEFAULT) it.roll = entry.roll
        }
      })
    }

    // write the hit locations out in bodyplan hit location table order. If there are
    // other entries, append them at the end.
    let temp = []
    Object.keys(table).forEach(key => {
      let results = Object.values(locations).filter(loc => loc.where === key)
      if (results.length > 0) {
        if (results.length > 1) {
          // If multiple locs have same where, concat the DRs.   Leg 7 & Leg 8 both map to "Leg 7-8"
          let d = ''
          var last
          results.forEach(r => {
            if (r.dr != last) {
              d += '|' + r.dr
              last = r.dr
            }
          })
          if (!!d) d = d.substr(1)
          results[0].dr = d
        }
        temp.push(results[0])
        locations = locations.filter(it => it.where !== key)
      } else {
        // Didn't find loc that should be in the table.   Make a default entry
        temp.push(new HitLocations.HitLocation(key, 0, table[key].penalty, table[key].roll))
      }
    })
    locations.forEach(it => temp.push(it))
    //   locations.forEach(it => temp.push(HitLocations.HitLocation.normalized(it)))

    let prot = {}
    let index = 0
    temp.forEach(it => game.GURPS.put(prot, it, index++))

    let saveprot = true
    if (!!data.lastImport && !!data.additionalresources.bodyplan && bodyplan != data.additionalresources.bodyplan) {
      let option = game.settings.get(settings.SYSTEM_NAME, settings.SETTING_IMPORT_BODYPLAN)
      if (option == 1) {
        saveprot = false
      }
      if (option == 2) {
        saveprot = await new Promise((resolve, reject) => {
          let d = new Dialog({
            title: 'Hit Location Body Plan',
            content:
              `Do you want to <br><br><b>Save</b> the current Body Plan (${game.i18n.localize(
                'GURPS.BODYPLAN' + data.additionalresources.bodyplan
              )}) or ` +
              `<br><br><b>Overwrite</b> it with the Body Plan from the import: (${game.i18n.localize(
                'GURPS.BODYPLAN' + bodyplan
              )})?<br><br>&nbsp;`,
            buttons: {
              save: {
                icon: '<i class="far fa-square"></i>',
                label: 'Save',
                callback: () => resolve(false),
              },
              overwrite: {
                icon: '<i class="fas fa-edit"></i>',
                label: 'Overwrite',
                callback: () => resolve(true),
              },
            },
            default: 'save',
            close: () => resolve(false), // just assume overwrite.   Error handling would be too much work right now.
          })
          d.render(true)
        })
      }
    }
    if (saveprot)
      return {
        'data.-=hitlocations': null,
        'data.hitlocations': prot,
        'data.additionalresources.bodyplan': bodyplan,
      }
    else return {}
  }

  /**
   *
   * @param {Array<HitLocations.HitLocation>} locations
   */
  _getBodyPlan(locations) {
    // each key is a "body plan" name like "humanoid" or "quadruped"
    let tableNames = Object.keys(HitLocations.hitlocationDictionary)

    // create a map of tableName:count
    let tableScores = {}
    tableNames.forEach(it => (tableScores[it] = 0))

    // increment the count for a tableScore if it contains the same hit location as "prot"
    locations.forEach(function (hitLocation) {
      tableNames.forEach(function (tableName) {
        if (HitLocations.hitlocationDictionary[tableName].hasOwnProperty(hitLocation.where)) {
          tableScores[tableName] = tableScores[tableName] + 1
        }
      })
    })

    // Select the tableScore with the highest score.
    let match = -1
    let name = HitLocations.HitLocation.HUMANOID
    Object.keys(tableScores).forEach(function (score) {
      if (tableScores[score] > match) {
        match = tableScores[score]
        name = score
      }
    })

    // In the case of a tie, select the one whose score is closest to the number of entries
    // in the table.
    let results = Object.keys(tableScores).filter(it => tableScores[it] === match)
    if (results.length > 1) {
      let diff = Number.MAX_SAFE_INTEGER
      results.forEach(key => {
        // find the smallest difference
        let table = HitLocations.hitlocationDictionary[key]
        if (Object.keys(table).length - match < diff) {
          diff = Object.keys(table).length - match
          name = key
        }
      })
    }

    return name
  }

  importEquipmentFromGCSv1(json, isFoundryGCS) {
    if (!json) return
    let t = this.textFrom
    let i = this.intFrom
    let f = this.floatFrom

    let temp = []
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let eqt = new Equipment()
        eqt.name = t(j.name)
        eqt.count = t(j.count)
        eqt.cost = t(j.cost)
        eqt.weight = t(j.weight)
        eqt.location = t(j.location)
        let cstatus = i(j.carried)
        eqt.carried = cstatus >= 1
        eqt.equipped = cstatus == 2
        eqt.techlevel = t(j.tl)
        eqt.legalityclass = t(j.lc)
        eqt.categories = t(j.type)
        eqt.uses = t(j.uses)
        eqt.maxuses = t(j.maxuses)
        eqt.uuid = t(j.uuid)
        eqt.parentuuid = t(j.parentuuid)
        if (isFoundryGCS) {
          eqt.notes = t(j.notes)
        } else {
          eqt.setNotes(t(j.notes))
        }
        eqt.pageRef(t(j.pageref))
        temp.push(eqt)
      }
    }

    // Put everything in it container (if found), otherwise at the top level
    temp.forEach(eqt => {
      if (!!eqt.parentuuid) {
        let parent = null
        parent = temp.find(e => e.uuid === eqt.parentuuid)
        if (!!parent) game.GURPS.put(parent.contains, eqt)
        else eqt.parentuuid = '' // Can't find a parent, so put it in the top list
      }
    })

    // Save the old User Entered Notes.
    recurselist(this.data.data.equipment.carried, t => {
      t.carried = true
      if (!!t.save) temp.push(t)
    }) // Ensure carried eqt stays in carried
    recurselist(this.data.data.equipment.other, t => {
      t.carried = false
      if (!!t.save) temp.push(t)
    })

    let equipment = {
      carried: {},
      other: {},
    }
    let cindex = 0
    let oindex = 0

    temp.forEach(eqt => {
      Equipment.calc(eqt)
      if (!eqt.parentuuid) {
        if (eqt.carried) game.GURPS.put(equipment.carried, eqt, cindex++)
        else game.GURPS.put(equipment.other, eqt, oindex++)
      }
    })
    return {
      'data.-=equipment': null,
      'data.equipment': equipment,
    }
  }

  // Fold a flat array into a hierarchical target object
  foldList(flat, target = {}) {
    flat.forEach(obj => {
      if (!!obj.parentuuid) {
        const parent = flat.find(o => o.uuid == obj.parentuuid)
        if (!!parent) {
          if (!parent.contains) parent.contains = {} // lazy init for older characters
          game.GURPS.put(parent.contains, obj)
        } else obj.parentuuid = '' // Can't find a parent, so put it in the top list.  should never happen with GCS
      }
    })
    let index = 0
    flat.forEach(obj => {
      if (!obj.parentuuid) game.GURPS.put(target, obj, index++)
    })
    return target
  }

  importEncumbranceFromGCSv1(json) {
    if (!json) return
    let t = this.textFrom
    let es = {}
    let index = 0
    let cm = 0
    let cd = 0
    for (let i = 0; i < 5; i++) {
      let e = new Encumbrance()
      e.level = i
      let k = 'enc_' + i
      let c = t(json[k])
      e.current = c === '1'
      k = 'enc' + i
      e.key = k
      let k2 = k + '_weight'
      e.weight = t(json[k2])
      k2 = k + '_move'
      e.move = this.intFrom(json[k2])
      k2 = k + '_dodge'
      e.dodge = this.intFrom(json[k2])
      if (e.current) {
        cm = e.move
        cd = e.dodge
      }
      game.GURPS.put(es, e, index++)
    }
    return {
      'data.currentmove': cm,
      'data.currentdodge': cd,
      'data.-=encumbrance': null,
      'data.encumbrance': es,
    }
  }

  importCombatMeleeFromGCSv1(json, isFoundryGCS) {
    if (!json) return
    let t = this.textFrom
    let melee = {}
    let index = 0
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let oldnote = t(j.notes)
        for (let k2 in j.meleemodelist) {
          if (k2.startsWith('id-')) {
            let j2 = j.meleemodelist[k2]
            let m = new Melee()
            m.name = t(j.name)
            m.st = t(j.st)
            m.weight = t(j.weight)
            m.techlevel = t(j.tl)
            m.cost = t(j.cost)
            if (isFoundryGCS) {
              m.notes = t(j2.notes) || oldnote
              m.pageref = t(j2.pageref)
            } else
              try {
                m.setNotes(t(j.text))
              } catch {
                console.log(m)
                console.log(t(j.text))
              }
            m.mode = t(j2.name)
            m.import = t(j2.level)
            m.damage = t(j2.damage)
            m.reach = t(j2.reach)
            m.parry = t(j2.parry)
            m.block = t(j2.block)
            game.GURPS.put(melee, m, index++)
          }
        }
      }
    }
    return {
      'data.-=melee': null,
      'data.melee': melee,
    }
  }

  importCombatRangedFromGCSv1(json, isFoundryGCS) {
    if (!json) return
    let t = this.textFrom
    let ranged = {}
    let index = 0
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let oldnote = t(j.notes)
        for (let k2 in j.rangedmodelist) {
          if (k2.startsWith('id-')) {
            let j2 = j.rangedmodelist[k2]
            let r = new Ranged()
            r.name = t(j.name)
            r.st = t(j.st)
            r.bulk = t(j.bulk)
            r.legalityclass = t(j.lc)
            r.ammo = t(j.ammo)
            if (isFoundryGCS) {
              r.notes = t(j2.notes) || oldnote
              r.pageref = t(j2.pageref)
            } else
              try {
                r.setNotes(t(j.text))
              } catch {
                console.log(r)
                console.log(t(j.text))
              }
            r.mode = t(j2.name)
            r.import = t(j2.level)
            r.damage = t(j2.damage)
            r.acc = t(j2.acc)
            r.rof = t(j2.rof)
            r.shots = t(j2.shots)
            r.rcl = t(j2.rcl)
            let rng = t(j2.range)
            let m = rng.match(/^ *x(\d+) $/)
            if (m) {
              rng = parseInt(m[1]) * this.data.data.attributes.ST.value
            } else {
              m = rng.match(/^ *x(\d+) *\/ *x(\d+) *$/)
              if (m) {
                rng = `${parseInt(m[1]) * this.data.data.attributes.ST.value}/${
                  parseInt(m[2]) * this.data.data.attributes.ST.value
                }`
              }
            }
            r.range = rng
            game.GURPS.put(ranged, r, index++)
          }
        }
      }
    }
    return {
      'data.-=ranged': null,
      'data.ranged': ranged,
    }
  }

  importTraitsfromGCSv1(json) {
    if (!json) return
    let t = this.textFrom
    let ts = {}
    ts.race = t(json.race)
    ts.height = t(json.height)
    ts.weight = t(json.weight)
    ts.age = t(json.age)
    ts.title = t(json.title)
    ts.player = t(json.player)
    ts.createdon = t(json.createdon)
    ts.modifiedon = t(json.modifiedon)
    ts.religion = t(json.religion)
    ts.birthday = t(json.birthday)
    ts.hand = t(json.hand)
    ts.sizemod = t(json.sizemodifier)
    ts.techlevel = t(json.tl)
    // <appearance type="string">@GENDER, Eyes: @EYES, Hair: @HAIR, Skin: @SKIN</appearance>
    let a = t(json.appearance)
    ts.appearance = a
    try {
      let x = a.indexOf(', Eyes: ')
      if (x >= 0) {
        ts.gender = a.substring(0, x)
        let y = a.indexOf(', Hair: ')
        ts.eyes = a.substring(x + 8, y)
        x = a.indexOf(', Skin: ')
        ts.hair = a.substring(y + 8, x)
        ts.skin = a.substr(x + 8)
      }
    } catch {
      console.log('Unable to parse appearance traits for ')
      console.log(this)
    }
    return {
      'data.-=traits': null,
      'data.traits': ts,
    }
  }

  // Import the <attributes> section of the GCS FG XML file.
  async importAttributesFromCGSv1(json) {
    if (!json) return
    let i = this.intFrom // shortcut to make code smaller
    let t = this.textFrom
    let data = this.data.data
    let att = data.attributes

    // attribute.values will be calculated in calculateDerivedValues()
    att.ST.import = i(json.strength)
    att.ST.points = i(json.strength_points)
    att.DX.import = i(json.dexterity)
    att.DX.points = i(json.dexterity_points)
    att.IQ.import = i(json.intelligence)
    att.IQ.points = i(json.intelligence_points)
    att.HT.import = i(json.health)
    att.HT.points = i(json.health_points)
    att.WILL.import = i(json.will)
    att.WILL.points = i(json.will_points)
    att.PER.import = i(json.perception)
    att.PER.points = i(json.perception_points)

    data.HP.max = i(json.hitpoints)
    data.HP.points = i(json.hitpoints_points)
    data.FP.max = i(json.fatiguepoints)
    data.FP.points = i(json.fatiguepoints_points)
    let hp = i(json.hps)
    let fp = i(json.fps)
    let saveCurrent = false
    if (!!data.lastImport && (data.HP.value != hp || data.FP.value != fp)) {
      let option = game.settings.get(settings.SYSTEM_NAME, settings.SETTING_IMPORT_HP_FP)
      if (option == 0) {
        saveCurrent = true
      }
      if (option == 2) {
        saveCurrent = await new Promise((resolve, reject) => {
          let d = new Dialog({
            title: 'Current HP & FP',
            content: `Do you want to <br><br><b>Save</b> the current HP (${data.HP.value}) & FP (${data.FP.value}) values or <br><br><b>Overwrite</b> it with the import data, HP (${hp}) & FP (${fp})?<br><br>&nbsp;`,
            buttons: {
              save: {
                icon: '<i class="far fa-square"></i>',
                label: 'Save',
                callback: () => resolve(true),
              },
              overwrite: {
                icon: '<i class="fas fa-edit"></i>',
                label: 'Overwrite',
                callback: () => resolve(false),
              },
            },
            default: 'save',
            close: () => resolve(false), // just assume overwrite.   Error handling would be too much work right now.
          })
          d.render(true)
        })
      }
    }
    if (!saveCurrent) {
      data.HP.value = hp
      data.FP.value = fp
    }

    let lm = {}
    lm.basiclift = t(json.basiclift)
    lm.carryonback = t(json.carryonback)
    lm.onehandedlift = t(json.onehandedlift)
    lm.runningshove = t(json.runningshove)
    lm.shiftslightly = t(json.shiftslightly)
    lm.shove = t(json.shove)
    lm.twohandedlift = t(json.twohandedlift)

    data.basicmove.value = t(json.basicmove)
    data.basicmove.points = i(json.basicmove_points)
    data.basicspeed.value = t(json.basicspeed)
    data.basicspeed.points = i(json.basicspeed_points)
    data.thrust = t(json.thrust)
    data.swing = t(json.swing)
    data.currentmove = t(json.move)
    data.frightcheck = i(json.frightcheck)

    data.hearing = i(json.hearing)
    data.tastesmell = i(json.tastesmell)
    data.touch = i(json.touch)
    data.vision = i(json.vision)

    return {
      'data.attributes': att,
      'data.HP': data.HP,
      'data.FP': data.FP,
      'data.basiclift': data.basiclift,
      'data.basicmove': data.basicmove,
      'data.basicspeed': data.basicspeed,
      'data.thrust': data.thrust,
      'data.swing': data.swing,
      'data.currentmove': data.currentmove,
      'data.frightcheck': data.frightcheck,
      'data.hearing': data.hearing,
      'data.tastesmell': data.tastesmell,
      'data.touch': data.touch,
      'data.vision': data.vision,
      'data.liftingmoving': lm,
    }
  }

  // create/update the skills.
  // NOTE:  For the update to work correctly, no two skills can have the same name.
  // When reading data, use "this.data.data.skills", however, when updating, use "data.skills".
  importSkillsFromGCSv1(json, isFoundryGCS) {
    if (!json) return
    let temp = []
    let t = this.textFrom /// shortcut to make code smaller
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let sk = new Skill()
        sk.name = t(j.name)
        sk.type = t(j.type)
        sk.import = t(j.level)
        if (sk.level == 0) sk.level = ''
        sk.points = this.intFrom(j.points)
        sk.relativelevel = t(j.relativelevel)
        if (isFoundryGCS) {
          sk.notes = t(j.notes)
          sk.pageref = t(j.pageref)
        } else sk.setNotes(t(j.text))
        if (!!j.pageref) sk.pageref = t(j.pageref)
        sk.uuid = t(j.uuid)
        sk.parentuuid = t(j.parentuuid)
        temp.push(sk)
      }
    }
    return {
      'data.-=skills': null,
      'data.skills': this.foldList(temp),
    }
  }

  // create/update the spells.
  // NOTE:  For the update to work correctly, no two spells can have the same name.
  // When reading data, use "this.data.data.spells", however, when updating, use "data.spells".
  importSpellsFromGCSv1(json, isFoundryGCS) {
    if (!json) return
    let temp = []
    let t = this.textFrom /// shortcut to make code smaller
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let sp = new Spell()
        sp.name = t(j.name)
        sp.class = t(j.class)
        sp.college = t(j.college)
        if (isFoundryGCS) {
          sp.cost = t(j.cost)
          sp.maintain = t(j.maintain)
          sp.difficulty = t(j.difficulty)
          sp.notes = t(j.notes)
        } else {
          let cm = t(j.costmaintain)
          let i = cm.indexOf('/')
          if (i >= 0) {
            sp.cost = cm.substring(0, i)
            sp.maintain = cm.substr(i + 1)
          } else {
            sp.cost = cm
          }
          sp.setNotes(t(j.text))
        }
        sp.pageref = t(j.pageref)
        sp.duration = t(j.duration)
        sp.points = t(j.points)
        sp.casttime = t(j.time)
        sp.import = t(j.level)
        sp.duration = t(j.duration)
        sp.uuid = t(j.uuid)
        sp.parentuuid = t(j.parentuuid)
        temp.push(sp)
      }
    }
    return {
      'data.-=spells': null,
      'data.spells': this.foldList(temp),
    }
  }

  importAdsFromGCA(adsjson, disadsjson) {
    let list = []
    this.importBaseAdvantages(list, adsjson)
    this.importBaseAdvantages(list, disadsjson)
    return {
      'data.-=ads': null,
      'data.ads': this.foldList(list),
    }
  }

  importBaseAdvantages(datalist, json) {
    if (!json) return
    let t = this.textFrom /// shortcut to make code smaller
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let a = new Advantage()
        a.name = t(j.name)
        a.points = this.intFrom(j.points)
        a.setNotes(t(j.text))
        a.pageref = t(j.pageref) || a.pageref
        a.uuid = t(j.uuid)
        a.parentuuid = t(j.parentuuid)
        datalist.push(a)
      }
    }
  }

  // In the new GCS import, all ads/disad/quirks/perks are in one list.
  importAdsFromGCSv2(json) {
    let t = this.textFrom /// shortcut to make code smaller
    let temp = []
    for (let key in json) {
      if (key.startsWith('id-')) {
        // Allows us to skip over junk elements created by xml->json code, and only select the skills.
        let j = json[key]
        let a = new Advantage()
        a.name = t(j.name)
        a.points = this.intFrom(j.points)
        a.note = t(j.notes)
        a.userdesc = t(j.userdesc)
        a.notes = ''
        if (!!a.note && !!a.userdesc) a.notes = a.note + '\n' + a.userdesc
        else if (!!a.note) a.notes = a.note
        else if (!!a.userdesc) a.notes = a.userdesc
        a.pageref = t(j.pageref)
        a.uuid = t(j.uuid)
        a.parentuuid = t(j.parentuuid)
        temp.push(a)
      }
    }
    return {
      'data.-=ads': null,
      'data.ads': this.foldList(temp),
    }
  }

  /**
   * Adds any assigned resource trackers to the actor data and sheet.
   */
  async setResourceTrackers() {
    // find those with non-blank slots
    let templates = ResourceTrackerManager.getAllTemplates().filter(it => !!it.slot)

    templates.forEach(async template => {
      // find the matching data on this actor
      let path = `additionalresources.tracker.${template.slot}`
      let tracker = getProperty(this.data.data, path)

      // skip if already set
      if (tracker !== null && tracker.name === template.tracker.name) {
        return
      }

      // if not blank, don't overwrite
      if (tracker !== null && !!tracker.name) {
        ui.notifications.warn(
          `Will not overwrite Tracker ${template.slot} as its name is set to ${tracker.name}. Create Tracker for ${template.tracker.name} failed.`
        )
        return
      }

      await this.applyTrackerTemplate(path, template)
    })
  }

  /**
   * Update this tracker slot with the contents of the template.
   * @param {String} path JSON data path to the tracker; must start with 'additionalresources.tracker.'
   * @param {*} template to apply
   */
  async applyTrackerTemplate(path, template) {
    // is there an initializer? If so calculate its value
    let value = 0
    if (!!template.initialValue) {
      value = parseInt(template.initialValue, 10)
      if (Number.isNaN(value)) {
        // try to use initialValue as a path to another value
        value = getProperty(this.data.data, template.initialValue)
      }
    }
    template.tracker.max = value
    template.tracker.value = template.tracker.isDamageTracker ? template.tracker.min : value

    // remove whatever is there
    await this.removeTracker(path)

    // add the new tracker
    let update = {}
    update[`data.${path}`] = template.tracker
    await this.update(update)
  }

  /**
   * Overwrites the tracker pointed to by the path with default/blank values.
   * @param {String} path JSON data path to the tracker; must start with 'additionalresources.tracker.'
   */
  async removeTracker(path) {
    // verify that this is a Tracker
    if (!path.startsWith('additionalresources.tracker.'))
      throw `Invalid actor data path, actor=[${this.actor.id}] path=[${path}]`

    let update = {}
    update[`data.${path}`] = {
      name: '',
      alias: '',
      pdf: '',
      max: 0,
      min: 0,
      value: 0,
      isDamageTracker: false,
      isDamageType: false,
      initialValue: '',
      thresholds: [],
    }
    await this.update(update)
  }

  // --- Functions to handle events on actor ---

  handleDamageDrop(damageData) {
    if (game.user.isGM || !game.settings.get(settings.SYSTEM_NAME, settings.SETTING_ONLY_GMS_OPEN_ADD))
      new ApplyDamageDialog(this, damageData).render(true)
    else ui.notifications.warn('Only GMs are allowed to Apply Damage.')
  }

  // Drag and drop from Item colletion
  async handleItemDrop(dragData) {
    if (!this.owner) {
      ui.notifications.warn(i18n('GURPS.youDoNotHavePermssion'))
      return
    }
    let global = game.items.get(dragData.id)
    ui.notifications.info(global.name + ' => ' + this.name)
    await this.addNewItemData(global.data)
  }

  // Drag and drop from an equipment list
  async handleEquipmentDrop(dragData) {
    if (dragData.actorid == this.id) return false // same sheet drag and drop handled elsewhere
    if (!dragData.itemid) {
      ui.notifications.warn('GURPS.cannotDragNonFoundryEqt')
      return
    }
    let srcActor = game.actors.get(dragData.actorid)
    if (!!this.owner && !!srcActor.owner) {
      // same owner
      let item = await srcActor.deleteEquipment(dragData.key)
      await this.addNewItemData(item)
    } else {
      // different owners
      let eqt = GURPS.decode(srcActor.data, dragData.key)
      let destowner = game.users.players.find(p => this.hasPerm(p, 'OWNER'))
      if (!!destowner) {
        ui.notifications.info(`Asking ${this.name} if they want ${eqt.name}`)
        game.socket.emit('system.gurps', {
          type: 'dragEquipment1',
          srckey: dragData.key,
          srcuserid: game.user.id,
          srcactorid: dragData.actorid,
          destuserid: destowner.id,
          destactorid: this.id,
          itemData: dragData.itemData,
        })
      } else ui.notifications.warn(i18n('GURPS.youDoNotHavePermssion'))
    }
  }

  // Called from the ItemEditor to let us know our personal Item has been modified
  async updateItem(item) {
    delete item.editingActor
    let itemData = item.data
    await this._removeItemAdditions(itemData._id)
    this.ignoreRender = true
    let other = await this._removeItemElement(itemData._id, 'equipment.other') // try to remove from other
    if (!other) {
      // if not in other, remove from carried, and then re-add everything
      await this._removeItemElement(itemData._id, 'equipment.carried')
      await this.addItemData(itemData)
    } else {
      // If was in other... just add back to other (and forget addons)
      let commit = this._addNewItemEquipment(itemData, false)
      await this.update(commit)
    }
    this.ignoreRender = false
    this.sheet.render(true)
  }

  // create a new embedded item based on this item data and place in the carried list
  // This is how all Items are added originally.
  async addNewItemData(itemData) {
    if (!!itemData.data.data) itemData.data.data.equipped = true
    else itemData.data.equipped = true
    let localItemData = await this.createOwnedItem(itemData) // add a local Foundry Item based on some Item data
    await this.addItemData(localItemData)
  }

  // Once the Items has been added to our items list, add the equipment and any features
  async addItemData(itemData) {
    let commit = {}
    let { eqtkey, eqtcommit } = this._addNewItemEquipment(itemData)
    commit = { ...commit, ...eqtcommit }
    commit = { ...commit, ...(await this._addItemAdditions(itemData, eqtkey)) }
    await this.update(commit)
  }

  async _addItemAdditions(itemData, eqtkey) {
    let commit = {}
    commit = { ...commit, ...(await this._addItemElement(itemData, eqtkey, 'melee')) }
    commit = { ...commit, ...(await this._addItemElement(itemData, eqtkey, 'ranged')) }
    commit = { ...commit, ...(await this._addItemElement(itemData, eqtkey, 'ads')) }
    commit = { ...commit, ...(await this._addItemElement(itemData, eqtkey, 'skills')) }
    commit = { ...commit, ...(await this._addItemElement(itemData, eqtkey, 'spells')) }
    return commit
  }

  // called when equipment is being moved
  async updateItemAdditionsBasedOn(eqt, sourcePath, targetPath) {
    if (sourcePath.includes('.carried') && targetPath.includes('.other')) await this._removeItemAdditionsBasedOn(eqt)
    if (sourcePath.includes('.other') && targetPath.includes('.carried')) {
      await this._addItemAdditionsBasedOn(eqt, targetPath)
    }
  }

  // moving from other to carried
  async _addItemAdditionsBasedOn(eqt, eqtkey) {
    if (!eqt.itemid) return
    let item = await this.getOwnedItem(eqt.itemid)
    if (!!item.data.data) item.data.data.equipped = true
    else item.data.equipped = true
    await this.updateOwnedItem(item.data)
    let commit = await this._addItemAdditions(item.data, eqtkey)
    await this.update(commit)
  }

  // moving from carried to other
  async _removeItemAdditionsBasedOn(eqt) {
    if (!eqt.itemid) return
    await this._removeItemAdditions(eqt.itemid)
    let item = await this.getOwnedItem(eqt.itemid)
    if (!!item.data.data) item.data.data.equipped = false
    else item.data.equipped = false
    await this.updateOwnedItem(item.data)
  }

  // Make the initial equipment object (in the carried list)
  _addNewItemEquipment(itemData, carried = true) {
    let path = carried ? 'carried' : 'other'
    let list = { ...this.data.data.equipment[path] } // shallow copy the list
    let eqt = itemData.data.eqt
    eqt.itemid = itemData._id
    eqt.uuid = 'item-' + itemData._id
    Equipment.calc(eqt)
    let eqtkey = GURPS.put(list, eqt)
    return {
      eqtkey: 'data.equipment.' + path + '.' + eqtkey,
      eqtcommit: { ['data.equipment.' + path]: list },
    }
  }

  async _addItemElement(itemData, eqtkey, key) {
    let list = { ...this.data.data[key] } // shallow copy
    let i = 0
    for (const k in itemData.data[key]) {
      let e = duplicate(itemData.data[key][k])
      e.itemid = itemData._id
      e.uuid = key + '-' + i++ + '-' + itemData._id
      e.eqtkey = eqtkey
      if (!!e.otf) {
        if (e.otf.match(/^ *\d+ *$/)) {
          e.import = parseInt(e.otf)
        } else {
          let action = parselink(e.otf)
          if (!!action.action) {
            action.action.calcOnly = true
            e.import = '' + (await GURPS.performAction(action.action, this)) // collapse the OtF formula into a string
          }
        }
      }
      if (key == 'melee') {
        if (!isNaN(parseInt(e.parry))) {
          let m = e.parry.match(/([+-]\d+)(.*)/)
          if (!!m) {
            e.parrybonus = parseInt(m[1])
            e.parry = e.parrybonus + 3 + Math.floor(e.level / 2)
          }
          if (!!m && !!m[2]) e.parry = `${e.parry}${m[2]}`
        }
        if (!isNaN(e.block)) {
          let m = e.block.match(/([+-]\d+)(.*)/)
          if (!!m) {
            e.blockbonus = parseInt(m[1])
            e.block = e.blockbonus + 3 + Math.floor(e.level / 2)
          }
          if (!!m && !!m[2]) e.block = `${e.block}${m[2]}`
        }
      }
      GURPS.put(list, e)
    }
    return i == 0 ? {} : { ['data.' + key]: list }
  }

  // return the item data that was deleted (since it might be transferred)
  async deleteEquipment(path) {
    let eqt = GURPS.decode(this.data, path)
    var item
    if (!!eqt.itemid) {
      item = await this.getOwnedItem(eqt.itemid)
      await this.deleteOwnedItem(eqt.itemid)
      await this._removeItemAdditions(eqt.itemid)
    }
    await GURPS.removeKey(this, path)
    return item
  }

  async _removeItemAdditions(itemid) {
    this.ignoreRender = true
    await this._removeItemElement(itemid, 'melee')
    await this._removeItemElement(itemid, 'ranged')
    await this._removeItemElement(itemid, 'ads')
    await this._removeItemElement(itemid, 'skills')
    await this._removeItemElement(itemid, 'spells')
    this.ignoreRender = false
  }

  // We have to remove matching items after we searched through the list
  // because we cannot safely modify the list why iterating over it
  // and as such, we can only remove 1 key at a time and must use thw while loop to check again
  async _removeItemElement(itemid, key) {
    let found = true
    let any = false
    while (!!found) {
      found = false
      let list = getProperty(this.data.data, key)
      recurselist(list, (e, k, d) => {
        if (e.itemid == itemid) found = k
      })
      if (!!found) {
        any = true
        await GURPS.removeKey(this, 'data.' + key + '.' + found)
      }
    }
    return any
  }

  async moveEquipment(srckey, targetkey) {
    if (srckey.includes(targetkey) || targetkey.includes(srckey)) {
      ui.notifications.error('Unable to drag and drop withing the same hierarchy.   Try moving it elsewhere first.')
      return
    }
    let object = GURPS.decode(this.data, srckey)
    // Because we may be modifing the same list, we have to check the order of the keys and
    // apply the operation that occurs later in the list, first (to keep the indexes the same)
    let srca = srckey.split('.')
    srca.splice(0, 3)
    let tara = targetkey.split('.')
    tara.splice(0, 3)
    let max = Math.min(srca.length, tara.length)
    let isSrcFirst = false
    for (let i = 0; i < max; i++) {
      if (parseInt(srca[i]) < parseInt(tara[i])) isSrcFirst = true
    }
    if (targetkey.endsWith('.other') || targetkey.endsWith('.carried')) {
      let target = duplicate(GURPS.decode(this.data, targetkey))
      if (!isSrcFirst) await GURPS.removeKey(this, srckey)
      let eqtkey = GURPS.put(target, object)
      await this.updateItemAdditionsBasedOn(object, srckey, targetkey + '.' + eqtkey)
      await this.update({ [targetkey]: target })
      if (isSrcFirst) await GURPS.removeKey(this, srckey)
    } else {
      let d = new Dialog({
        title: object.name,
        content: '<p>Where do you want to drop this?</p>',
        buttons: {
          one: {
            icon: '<i class="fas fa-level-up-alt"></i>',
            label: 'Before',
            callback: async () => {
              if (!isSrcFirst) {
                await GURPS.removeKey(this, srckey)
                await this.updateParentOf(srckey)
              }
              await this.updateItemAdditionsBasedOn(object, srckey, targetkey)
              await GURPS.insertBeforeKey(this, targetkey, object)
              await this.updateParentOf(targetkey)
              if (isSrcFirst) {
                await GURPS.removeKey(this, srckey)
                await this.updateParentOf(srckey)
              }
            },
          },
          two: {
            icon: '<i class="fas fa-sign-in-alt"></i>',
            label: 'In',
            callback: async () => {
              if (!isSrcFirst) {
                await GURPS.removeKey(this, srckey)
                await this.updateParentOf(srckey)
              }
              let k = targetkey + '.contains.' + GURPS.genkey(0)
              await this.updateItemAdditionsBasedOn(object, srckey, targetkey)
              await GURPS.insertBeforeKey(this, k, object)
              await this.updateParentOf(k)
              if (isSrcFirst) {
                await GURPS.removeKey(this, srckey)
                await this.updateParentOf(srckey)
              }
            },
          },
        },
        default: 'one',
      })
      d.render(true)
    }
  }

  // This function merges the 'where' and 'dr' properties of this actor's hitlocations
  // with the roll value from the  HitLocations.hitlocationRolls, converting the
  // roll from a string to an array of numbers (see the _convertRollStringToArrayOfInt
  // function).
  //
  // return value is an object with the following structure:
  // 	{
  //  	where: string value from the hitlocations table,
  //  	dr: int DR value from the hitlocations table,
  //  	rollText: string value of the roll from the hitlocations table (examples: '5', '6-9', '-')
  //  	roll: array of int of the values that match rollText (examples: [5], [6,7,8,9], [])
  // 	}
  get hitLocationsWithDR() {
    let myhitlocations = []
    let table = this._hitLocationRolls
    for (const [key, value] of Object.entries(this.data.data.hitlocations)) {
      let rollText = value.roll
      if (!value.roll && !!table[value.where])
        // Can happen if manually edited
        rollText = table[value.where].roll
      if (!rollText) rollText = HitLocations.HitLocation.DEFAULT
      let dr = parseInt(value.dr)
      if (isNaN(dr)) dr = 0
      myhitlocations.push({
        where: value.where,
        dr: dr,
        roll: convertRollStringToArrayOfInt(rollText),
        rollText: rollText,
      })
    }
    return myhitlocations
  }

  /**
   * @returns the appropriate hitlocation table based on the actor's bodyplan
   */
  get _hitLocationRolls() {
    return HitLocations.HitLocation.getHitLocationRolls(this.data.data.additionalresources?.bodyplan)
  }

  // Return the 'where' value of the default hit location, or 'Random'
  // NOTE: could also return 'Large-Area'?
  get defaultHitLocation() {
    // TODO implement a system setting but (potentially) allow it to be overridden
    return game.settings.get('gurps', 'default-hitlocation')
  }

  getCurrentDodge() {
    return this.data.data.currentdodge
  }

  getCurrentMove() {
    return this.data.data.currentmove
  }

  getTorsoDr() {
    if (!this.data.data.hitlocations) return 0
    let hl = Object.values(this.data.data.hitlocations).find(h => h.penalty == 0)
    return !!hl ? hl.dr : 0
  }

  getEquipped(key) {
    let val = 0
    if (!!this.data.data.melee && !!this.data.data.equipment.carried)
      Object.values(this.data.data.melee).forEach(melee => {
        recurselist(this.data.data.equipment.carried, e => {
          if (!val && e.equipped && e.name == melee.name) {
            let t = parseInt(melee[key])
            if (!isNaN(t)) val = t
          }
        })
      })
    if (!val && !!this.data.data[key]) val = parseInt(this.data.data[key])
    return val
  }

  getEquippedParry() {
    return this.getEquipped('parry')
  }

  getEquippedBlock() {
    return this.getEquipped('block')
  }

  changeOneThirdStatus(option, flag) {
    this.update({ [`data.additionalresources.${option}`]: flag }).then(() => {
      this.calculateDerivedValues()

      let i18nMessage =
        option === 'isReeling'
          ? flag
            ? 'GURPS.chatTurnOnReeling'
            : 'GURPS.chatTurnOffReeling'
          : flag
          ? 'GURPS.chatTurnOnTired'
          : 'GURPS.chatTurnOffTired'

      let pdfref = option === 'isReeling' ? i18n('GURPS.pdfReeling', 'B419') : i18n('GURPS.pdfTired', 'B426')
      let msg = i18n_f(i18nMessage, {
        name: this.displayname,
        classStart: '<span class="pdflink">',
        classEnd: '</span>',
        pdfref: pdfref,
      })

      renderTemplate('systems/gurps/templates/chat-processing.html', { lines: [msg] }).then(content => {
        let users = this.getUsers(CONST.ENTITY_PERMISSIONS.OWNER, true)
        let ids = users.map(it => it._id)
        let messageData = {
          content: content,
          whisper: ids,
          type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
        }
        ChatMessage.create(messageData)
        ui.combat.render()
      })
    })
  }

  findEquipmentByName(pattern, otherFirst = false) {
    pattern = makeRegexPatternFrom(pattern, false)
    let pats = pattern.split('/')
    var eqt, key
    let list1 = otherFirst ? this.data.data.equipment.other : this.data.data.equipment.carried
    let list2 = otherFirst ? this.data.data.equipment.carried : this.data.data.equipment.other
    let pkey1 = otherFirst ? 'data.equipment.other.' : 'data.equipment.carried.'
    let pkey2 = otherFirst ? 'data.equipment.carried.' : 'data.equipment.other.'
    recurselist(
      list1,
      (e, k, d) => {
        let l = pats.length - 1
        let p = pats[Math.min(d, l)]
        if (e.name.match(p)) {
          if (!eqt && (d == l || pats.length == 1)) {
            eqt = e
            key = k
          }
        } else return pats.length == 1
      },
      pkey1
    )
    recurselist(
      list2,
      (e, k, d) => {
        let l = pats.length - 1
        let p = pats[Math.min(d, l)]
        if (e.name.match(p)) {
          if (!eqt && (d == l || pats.length == 1)) {
            eqt = e
            key = k
          }
        } else return pats.length == 1
      },
      pkey2
    )
    return [eqt, key]
  }

  checkEncumbance(currentWeight) {
    let encs = this.data.data.encumbrance
    let last = GURPS.genkey(0) // if there are encumbrances, there will always be a level0
    var best, prev
    for (let key in encs) {
      let enc = encs[key]
      if (enc.current) prev = key
      let w = parseFloat(enc.weight)
      if (w > 0) {
        last = key
        if (currentWeight <= w) {
          best = key
          break
        }
      }
    }
    if (!best) best = last // that has a weight
    if (best != prev) {
      for (let key in encs) {
        let enc = encs[key]
        let t = 'data.encumbrance.' + key + '.current'
        if (key === best) {
          this.update({
            [t]: true,
            'data.currentmove': parseInt(enc.currentmove),
            'data.currentdodge': parseInt(enc.currentdodge),
          })
        } else if (enc.current) {
          this.update({ [t]: false })
        }
      }
    }
  }

  async updateParentOf(srckey) {
    // pindex = 4 for equipment
    let pindex = 4
    let sp = srckey.split('.').slice(0, pindex).join('.') // find the top level key in this list
    let eqt = GURPS.decode(this.data, sp)
    if (!!eqt) await Equipment.calcUpdate(this, eqt, sp) // and re-calc cost and weight sums
  }
}

export class Named {
  constructor(n1) {
    this.name = n1
    this.notes = ''
    this.pageref = ''
    this.contains = {}
  }

  pageRef(r) {
    this.pageref = r
    if (!!r && r.match(/[hH][tT][Tt][pP][sS]?:\/\//)) {
      this.pageref = '*Link'
      this.externallink = r
    }
  }

  // This is an ugly hack to parse the GCS FG Formatted Text entries.   See the method cleanUpP() above.
  setNotes(n) {
    if (!!n) {
      let v = extractP(n)
      let k = 'Page Ref: '
      let i = v.indexOf(k)
      if (i >= 0) {
        this.notes = v.substr(0, i).trim()
        // Find the "Page Ref" and store it separately (to hopefully someday be used with PDF Foundry)
        this.pageref = v.substr(i + k.length).trim()
      } else {
        this.notes = v.trim()
        this.pageref = ''
      }
    }
  }
}

export class NamedCost extends Named {
  constructor() {
    super()
    this.points = 0
  }
}

export class Leveled extends NamedCost {
  constructor(n1, lvl) {
    super(n1)
    this.import = lvl
  }
}

export class Skill extends Leveled {
  constructor() {
    super()
    this.type = '' // "DX/E";
    this.relativelevel = '' // "DX+1";
  }
}

export class Spell extends Leveled {
  constructor() {
    super()
    this.class = ''
    this.college = ''
    this.cost = ''
    this.maintain = ''
    this.duration = ''
    this.resist = ''
    this.casttime = ''
    this.difficulty = ''
  }
}

export class Advantage extends NamedCost {
  constructor() {
    super()
    this.userdesc = ''
    this.note = ''
  }
}

export class Attack extends Named {
  constructor(n1, lvl, dmg) {
    super(n1)
    this.import = lvl
    this.damage = dmg
    this.st = ''
    this.mode = ''
    this.level = ''
  }
}

export class Melee extends Attack {
  constructor() {
    super()

    this.weight = ''
    this.techlevel = ''
    this.cost = ''
    this.reach = ''
    this.parry = ''
    this.block = ''
  }
}

export class Ranged extends Attack {
  constructor() {
    super()

    this.bulk = ''
    this.legalityclass = ''
    this.ammo = ''
    this.acc = ''
    this.range = ''
    this.rof = ''
    this.shots = ''
    this.rcl = ''
  }
  checkRange() {
    if (!!this.halfd) this.range = this.halfd
    if (!!this.max) this.range = this.max
    if (!!this.halfd && !!this.max) this.range = this.halfd + '/' + this.max
  }
}

export class Encumbrance {
  constructor() {
    this.key = ''
    this.level = 0
    this.dodge = 9
    this.weight = ''
    this.move = ''
    this.current = false
  }
}

export class Note extends Named {
  constructor(n, ue) {
    super()
    this.notes = n || ''
    this.save = ue
  }
}

export class Equipment extends Named {
  constructor(nm, ue) {
    super(nm)
    this.save = ue
    this.equipped = false
    this.carried = false
    this.count = 0
    this.cost = 0
    this.weight = 0
    this.location = ''
    this.techlevel = ''
    this.legalityclass = ''
    this.categories = ''
    this.costsum = ''
    this.weightsum = ''
    this.uses = ''
    this.maxuses = ''
  }

  static calc(eqt) {
    Equipment.calcUpdate(null, eqt, '')
  }

  // OMG, do NOT fuck around with this method.   So many gotchas...
  // the worst being that you cannot use array.forEach.   You must use a for loop
  static async calcUpdate(actor, eqt, objkey) {
    const num = s => {
      return isNaN(s) ? 0 : Number(s)
    }
    const cln = s => {
      return !s ? 0 : num(String(s).replace(/,/g, ''))
    }

    eqt.count = cln(eqt.count)
    eqt.cost = cln(eqt.cost)
    eqt.weight = cln(eqt.weight)
    let cs = eqt.count * eqt.cost
    let ws = eqt.count * eqt.weight
    if (!!eqt.contains) {
      for (let k in eqt.contains) {
        let e = eqt.contains[k]
        await Equipment.calcUpdate(actor, e, objkey + '.contains.' + k)
        cs += e.costsum
        ws += e.weightsum
      }
    }
    if (!!eqt.collapsed) {
      for (let k in eqt.collapsed) {
        let e = eqt.contains[k]
        await Equipment.calcUpdate(actor, e, objkey + '.collapsed.' + k)
        cs += e.costsum
        ws += e.weightsum
      }
    }
    if (!!actor)
      await actor.update({
        [objkey + '.costsum']: cs,
        [objkey + '.weightsum']: ws,
      })
    // the local values 'should' be updated... but I need to force them anyway
    eqt.costsum = cs
    eqt.weightsum = ws
  }
}
export class Reaction {
  constructor(m, s) {
    this.modifier = m || ''
    this.situation = s || ''
  }
}

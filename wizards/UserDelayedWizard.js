// ===================
// add gym wizard
// ===================
const WizardScene = require('telegraf/scenes/wizard')
const moment = require('moment-timezone')
const { Markup } = require('telegraf')
var models = require('../models')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
const listRaids = require('../util/listRaids')
const setLocale = require('../util/setLocale')
const escapeMarkDown = require('../util/escapeMarkDown')

moment.tz.setDefault('Europe/Amsterdam')

var UserDelayedGymWizard = function (bot) {
  return new WizardScene('user-delayed-wizard',
    async (ctx) => {
      await setLocale(ctx)
      ctx.session.delayedraid = null
      const user = ctx.from
      const raids = await models.Raid.findAll({
        where: {
          endtime: {
            [Op.gt]: moment().unix()
          }
        },
        include: [
          models.Gym,
          {
            model: models.Raiduser,
            where: {
              uid: user.id
            }
          }
        ]
      })
      if (raids.length === 0) {
        return ctx.replyWithMarkdown(ctx.i18n.t('join_raid_no_raids_found'), Markup.removeKeyboard())
          .then(() => ctx.scene.leave())
      }
      // buttons to show, with index from candidates as data (since maxlength of button data is 64 bytes…)
      ctx.session.raidbtns = []
      const candidates = []
      for (var a = 0; a < raids.length; a++) {
        const strttm = moment.unix(raids[a].start1).format('H:mm')
        candidates[a] = {
          gymname: raids[a].Gym.gymname,
          raidid: raids[a].id,
          startsat: strttm
        }
        ctx.session.raidbtns.push(`${raids[a].Gym.gymname} ${strttm}; ${raids[a].target}`)
      }
      candidates.push({
        gymname: ctx.i18n.t('user_delayed_dont_change_status'),
        raidid: 0
      })
      ctx.session.raidbtns.push(ctx.i18n.t('user_delayed_dont_change_status'))
      // save all candidates to session…
      ctx.session.raidcandidates = candidates
      return ctx.replyWithMarkdown(ctx.i18n.t('user_delayed_select_raid'), Markup.keyboard(ctx.session.raidbtns).oneTime().resize().extra())
        .then(() => ctx.wizard.next())
    },

    async (ctx) => {
      // retrieve selected candidate  from session…
      const ind = ctx.session.raidbtns.indexOf(ctx.update.message.text)
      if (ind === -1) {
        return ctx.replyWithMarkdown(ctx.i18n.t('join_raid_not_found'), Markup.removeKeyboard().extra())
      }
      const selectedraid = ctx.session.raidcandidates[ind]
      if (selectedraid.raidid === 0) {
        return ctx.replyWithMarkdown(ctx.i18n.t('join_raid_cancel'), Markup.removeKeyboard().extra())
          .then(() => {
            ctx.session.raidcandidates = null
            return ctx.scene.leave()
          })
      }
      // save selected index to session
      ctx.session.delayedraid = parseInt(ind)
      ctx.session.accountbtns = [['2', '5'], [ctx.i18n.t('user_delayed_is_on_time')]]
      return ctx.replyWithMarkdown(`${ctx.i18n.t('user_delayed_how_much_later', { gymname: selectedraid.gymname })}`, Markup.keyboard(ctx.session.accountbtns).extra())
        .then(() => ctx.wizard.next())
    },
    async (ctx) => {
      const delay = ctx.update.message.text
      const delayedraid = ctx.session.raidcandidates[ctx.session.delayedraid]
      const user = ctx.from
      // Check already registered? If so; update
      const raiduser = await models.Raiduser.findOne({
        where: {
          [Op.and]: [{ uid: user.id }, { raidId: delayedraid.raidid }]
        }
      })
      if (raiduser) {
        let reason = ''
        let val = null
        // save users langugage
        const oldlocale = ctx.i18n.locale()
        switch (delay) {
          case '2':
            // reason should always be in default locale
            ctx.i18n.locale(process.env.DEFAULT_LOCALE)
            reason = `${ctx.i18n.t('user_delayed_by_2min', {
              first_name: escapeMarkDown(user.first_name),
              uid: user.id,
              gymname: delayedraid.gymname
            })}`
            val = '2 min.'
            // restore user locale
            ctx.i18n.locale(oldlocale)
            break
          case '5':
            // reason should always be in default locale
            ctx.i18n.locale(process.env.DEFAULT_LOCALE)
            reason = `${ctx.i18n.t('user_delayed_by_5min', {
              first_name: escapeMarkDown(user.first_name),
              uid: user.id,
              gymname: delayedraid.gymname
            })}`
            val = '5 min.'
            // restore user locale
            ctx.i18n.locale(oldlocale)
            break
          case ctx.i18n.t('user_delayed_is_on_time'):
            // reason should always be in default locale
            ctx.i18n.locale(process.env.DEFAULT_LOCALE)
            reason = `${ctx.i18n.t('user_delayed_on_time', {
              first_name: escapeMarkDown(user.first_name),
              uid: user.id,
              gymname: delayedraid.gymname
            })}`
            val = null
            // restore user locale
            ctx.i18n.locale(oldlocale)
            break
        }
        try {
          await models.Raiduser.update(
            { delayed: val },
            { where: { [Op.and]: [{ uid: user.id }, { raidId: delayedraid.raidid }] } }
          )
        } catch (error) {
          return ctx.replyWithMarkdown(`${ctx.i18n.t('user_delayed_selection_wrong')})`, Markup.removeKeyboard().extra())
            .then(() => ctx.scene.leave())
        }
        const out = await listRaids(`${reason}\n\n`, ctx)
        return ctx.replyWithMarkdown(`${ctx.i18n.t('user_delayed_status_changed', {
          gymname: delayedraid.gymname
        })}`, Markup.removeKeyboard().extra())
          .then(async () => {
            bot.telegram.sendMessage(process.env.GROUP_ID, out, { parse_mode: 'Markdown', disable_web_page_preview: true })
          })
          .then(() => ctx.scene.leave())
      }
    }
  )
}
module.exports = UserDelayedGymWizard

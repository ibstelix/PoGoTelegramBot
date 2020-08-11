// ===================
// Edit raid wizard
// ===================
const WizardScene = require('telegraf/scenes/wizard')
const moment = require('moment-timezone')
const { Markup } = require('telegraf')
var models = require('../models')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
const inputTime = require('../util/inputTime')
const listRaids = require('../util/listRaids')
const sendRaidbossNotifications = require('../util/sendRaidbossNotifications')
const resolveRaidBoss = require('../util/resolveRaidBoss')
const setLocale = require('../util/setLocale')
const TIMINGS = require('../timeSettings.js')
const escapeMarkDown = require('../util/escapeMarkDown')

moment.tz.setDefault('Europe/Amsterdam')

async function isAdmin (bot, user) {
  let isAdmin = false
  const admins = await bot.telegram.getChatAdministrators(process.env.GROUP_ID)
  for (let a = 0; a < admins.length; a++) {
    if (admins[a].user.id === user.id) {
      isAdmin = true
    }
  }
  // or marked admin from database?
  if (!isAdmin) {
    const dbAdmin = await models.User.findOne({
      where: {
        tId: {
          [Op.eq]: user.id
        },
        [Op.and]: {
          isAdmin: {
            [Op.eq]: true
          }
        }
      }
    })
    if (dbAdmin !== null) {
      isAdmin = true
    }
  }
  return isAdmin
}
function EditRaidWizard (bot) {
  return new WizardScene('edit-raid-wizard',

    // step 0: choose raid
    async (ctx) => {
      await setLocale(ctx)
      // reset some values for gym editting
      ctx.session.newgymid = null
      ctx.session.editattr = null

      const until = moment()
      if (await isAdmin(bot, ctx.from)) {
        until.subtract(1, 'hour')
      }
      const raids = await models.Raid.findAll({
        include: [models.Gym, models.Raiduser],
        where: {
          endtime: {
            [Op.gt]: until.unix()
          }
        }
      })
      if (raids.length === 0) {
        return ctx.replyWithMarkdown(ctx.i18n.t('edit_raid_no_raids_found'), Markup.removeKeyboard())
          .then(() => ctx.scene.leave())
      }
      ctx.session.raidbtns = []
      ctx.session.raidcandidates = []
      for (var a = 0; a < raids.length; a++) {
        ctx.session.raidcandidates[a] = {
          gymname: raids[a].Gym.gymname.trim(),
          id: raids[a].id,
          start1: raids[a].start1,
          endtime: raids[a].endtime,
          target: raids[a].target
        }
        ctx.session.raidbtns.push(`${raids[a].Gym.gymname}, ${ctx.i18n.t('edit_raid_until')}: ${moment.unix(raids[a].endtime).format('HH:mm')}, ${ctx.i18n.t('edit_raid_start')}: ${moment.unix(raids[a].start1).format('HH:mm')}; ${raids[a].target}`)
      }
      ctx.session.raidcandidates.push({
        gymname: ctx.i18n.t('edit_raid_not_found'),
        id: 0
      })
      ctx.session.raidbtns.push(ctx.i18n.t('edit_raid_not_found'))

      // save all candidates to session…
      return ctx.replyWithMarkdown(`${ctx.i18n.t('edit_raid_which_raid')}`,
        Markup.keyboard(ctx.session.raidbtns)
          .oneTime()
          .resize()
          .extra()
      )
        .then(() => ctx.wizard.next())
    },

    // step 1: raid chosen, edit what?
    async (ctx) => {
      // retrieve selected candidate from session…
      if (ctx.session.more !== true) {
        let selectedraid = null
        for (let i = 0; i < ctx.session.raidbtns.length; i++) {
          if (ctx.session.raidbtns[i] === ctx.update.message.text) {
            selectedraid = ctx.session.raidcandidates[i]
            break
          }
        }
        // Catch gym not found errors…
        if (selectedraid === null) {
          return ctx.replyWithMarkdown('Er ging iets fout bij het kiezen van de gym.\n*Gebruik */start* om het nog eens te proberen…*\n', Markup.removeKeyboard().extra())
            .then(() => {
              ctx.session = {}
              return ctx.scene.leave()
            })
        }

        if (selectedraid.id === 0) {
          return ctx.replyWithMarkdown(ctx.i18n.t('cancelmessage'), Markup.removeKeyboard().extra())
            .then(() => {
              ctx.session = {}
              return ctx.scene.leave()
            })
        }
        // save selected index to session
        ctx.session.editraid = selectedraid
      }
      ctx.session.changebtns = [
        [`${ctx.i18n.t('edit_raid_gym')}: ${ctx.session.editraid.gymname}`, 'gym'],
        [`${ctx.i18n.t('edit_raid_endtime')}: ${moment.unix(ctx.session.editraid.endtime).format('HH:mm')}`, 'endtime'],
        [`${ctx.i18n.t('edit_raid_starttime')}: ${moment.unix(ctx.session.editraid.start1).format('HH:mm')}`, 'start1'],
        [`${ctx.i18n.t('edit_raid_pokemon')}: ${ctx.session.editraid.target}`, 'target'],
        [ctx.i18n.t('btn_edit_gym_cancel'), 0]
      ]
      return ctx.replyWithMarkdown(ctx.i18n.t('edit_what'), Markup.keyboard(ctx.session.changebtns.map(el => el[0])).oneTime().resize().extra())
        .then(() => ctx.wizard.next())
    },

    // step 2: chosen what to edit, enter a value
    async (ctx) => {
      let editattr
      for (let i = 0; i < ctx.session.changebtns.length; i++) {
        if (ctx.session.changebtns[i][0] === ctx.update.message.text) {
          editattr = ctx.session.changebtns[i][1]
        }
      }
      if (editattr === 0) {
        return ctx.replyWithMarkdown(ctx.i18n.t('cancelmessage'), Markup.removeKeyboard().extra())
          .then(() => {
            ctx.session = {}
            return ctx.scene.leave()
          })
      } else {
        let question = ''
        switch (editattr) {
          case 'endtime':
            ctx.session.editattr = 'endtime'
            question = ctx.i18n.t('edit_raid_question_endtime')
            break
          case 'start1':
            ctx.session.editattr = 'start1'
            const endtimestr = moment.unix(ctx.session.editraid.endtime).format('HH:mm')
            const start1str = moment.unix(ctx.session.editraid.endtime).subtract(TIMINGS.BOSS, 'minutes').format('HH:mm')
            question = ctx.i18n.t('edit_raid_question_starttime_range', {
              start1str: start1str,
              endtimestr: endtimestr
            })
            break
          case 'target':
            ctx.session.editattr = 'target'
            question = ctx.i18n.t('edit_raid_question_pokemon')
            break
          case 'gym':
            ctx.session.editattr = 'gym'
            ctx.wizard.selectStep(6)
            return ctx.wizard.steps[6](ctx)
          default:
            question = ctx.i18n.t('edit_raidboss_no_clue')
            return ctx.replyWithMarkdown(question)
              .then(() => ctx.scene.leave())
        }
        return ctx.replyWithMarkdown(question)
          .then(() => ctx.wizard.next())
      }
    },
    // step 3: enter new value or jump to 6 for entering a new gym
    async (ctx) => {
      const key = ctx.session.editattr
      let value = null
      // user has not just updated gym? If not expect text message
      if (key !== 'gymId') {
        value = ctx.update.message.text.trim()
      } else {
        value = ctx.session.newgymid
      }
      if (key === 'endtime' || key === 'start1') {
        const timevalue = inputTime(value)
        if (timevalue === false) {
          return ctx.replyWithMarkdown(ctx.i18n.t('invalid_time_retry'))
        }
        if (key === 'start1') {
          const endtime = moment.unix(ctx.session.editraid.endtime)
          const start = moment.unix(ctx.session.editraid.endtime).subtract(TIMINGS.BOSS, 'minutes')
          const start1 = moment.unix(timevalue)
          if (start.diff(moment(start1)) > 0 || endtime.diff(start1) < 0) {
            return ctx.replyWithMarkdown(ctx.i18n.t('invalid_time_retry'))
          }
        }
        value = timevalue
      }
      // Handle the raidboss:
      if (key === 'target') {
        const target = ctx.update.message.text.trim()
        // let's see if we can find the raidboss…
        const boss = await resolveRaidBoss(target)
        if (boss !== null) {
          ctx.session.editraid.target = boss.name
          ctx.session.editraid.bossid = boss.id
          ctx.session.editraid.accounts = boss.accounts
        } else {
          ctx.session.editraid.target = target
          ctx.session.editraid.accounts = null
          ctx.session.editraid.bossid = null
        }
      } else {
        ctx.session.editraid[key] = value
      }
      ctx.wizard.selectStep(4)
      return ctx.wizard.steps[4](ctx)
    },

    // step 4: do more or save?
    async (ctx) => {
      const out = `${ctx.i18n.t('until')}: ${moment.unix(ctx.session.editraid.endtime).format('HH:mm')}: *${ctx.session.editraid.target}*\n${ctx.session.editraid.bossid !== null ? ctx.i18n.t('edit_raidboss_overview_accounts') + ': ' + (ctx.session.editraid.accounts !== undefined ? ctx.session.editraid.accounts : '') + '\n' : ''}${ctx.session.editraid.gymname}\nStart: ${moment.unix(ctx.session.editraid.start1).format('HH:mm')}\n\n`
      ctx.session.savebtns = [
        ctx.i18n.t('edit_raidboss_btn_save_close'),
        ctx.i18n.t('edit_raid_edit_more'),
        ctx.i18n.t('cancel')
      ]
      return ctx.replyWithMarkdown(ctx.i18n.t('edit_raid_overview_data', {
        out: out
      }), Markup.keyboard(ctx.session.savebtns)
        .resize()
        .oneTime()
        .extra()
      )
        .then(() => ctx.wizard.next())
    },

    // step 5: save & exit or jump to 2
    async (ctx) => {
      const choice = ctx.session.savebtns.indexOf(ctx.update.message.text)
      switch (choice) {
        case 0:
          // save and exit
          const user = ctx.update.message.from
          try {
            await models.Raid.update(
              {
                endtime: ctx.session.editraid.endtime,
                start1: ctx.session.editraid.start1,
                target: ctx.session.editraid.target,
                gymId: ctx.session.editraid.gymId,
                raidbossId: ctx.session.editraid.bossid
              },
              {
                where: {
                  id: ctx.session.editraid.id
                }
              }
            )
            // save users langugage
            const oldlocale = ctx.i18n.locale()
            // reason should always be in default locale
            ctx.i18n.locale(process.env.DEFAULT_LOCALE)
            const reason = ctx.i18n.t('edit_raid_list_message', {
              gymname: ctx.session.editraid.gymname,
              user_first_name: escapeMarkDown(user.first_name),
              user: user
            })
            // restore user locale
            ctx.i18n.locale(oldlocale)
            const out = await listRaids(reason, ctx)
            console.log('ctx.session.oldlang', ctx.session.oldlang)
            bot.telegram.sendMessage(process.env.GROUP_ID, out, { parse_mode: 'Markdown', disable_web_page_preview: true })
            await sendRaidbosses(ctx, bot)
            return ctx.replyWithMarkdown(ctx.i18n.t('finished_procedure'), Markup.removeKeyboard().extra())
              .then(() => ctx.scene.leave())
          } catch (error) {
            console.error(error)
            return ctx.replyWithMarkdown(ctx.i18n.t('problem_while_saving'), Markup.removeKeyboard().extra())
              .then(() => ctx.scene.leave())
          }
        case 1:
          // more edits
          // set cursor to step 1 and trigger jump to step 1
          ctx.session.more = true
          return ctx.replyWithMarkdown(ctx.i18n.t('edit_more'))
            .then(() => ctx.wizard.selectStep(1))
            .then(() => ctx.wizard.steps[1](ctx))
        case 2:
          // Don't save and leave
          return ctx.replyWithMarkdown(ctx.i18n.t('finished_procedure_without_saving'), Markup.removeKeyboard().extra())
            .then(() => {
              ctx.session.raidcandidates = null
              ctx.session.editraid = null
              return ctx.scene.leave()
            })
      }
    },
    // =======

    // step 6: handle gym search
    async (ctx) => {
      const question = ctx.i18n.t('edit_raid_question_gym')
      return ctx.replyWithMarkdown(question)
        .then(() => ctx.wizard.next())
    },
    // Step 7: find gyms
    async (ctx) => {
      // why do i need this??
      if (ctx.update.message === undefined) {
        return
      }

      const term = ctx.update.message.text.trim()
      ctx.session.gymbtns = []
      if (term.length < 2) {
        return ctx.replyWithMarkdown(ctx.i18n.t('find_gym_two_chars_minimum'))
        // .then(() => ctx.wizard.back())
      } else {
        const candidates = await models.Gym.findAll({
          where: {
            gymname: { [Op.like]: '%' + term + '%' }
          }
        })
        if (candidates.length === 0) {
          // ToDo: check dit dan...
          return ctx.replyWithMarkdown(ctx.i18n.t('find_gym_failed_retry', {
            term: term === '/start help_fromgroup' ? '' : term
          }))
          // .then(() => ctx.wizard.back())
        }
        ctx.session.gymcandidates = []
        for (let i = 0; i < candidates.length; i++) {
          ctx.session.gymcandidates.push(
            {
              gymname: candidates[i].gymname, id: candidates[i].id
            }
          )
          ctx.session.gymbtns.push(candidates[i].gymname)
        }
        ctx.session.gymcandidates.push(
          {
            name: ctx.i18n.t('btn_gym_not_found'),
            id: 0
          }
        )
        ctx.session.gymbtns.push(ctx.i18n.t('btn_gym_not_found'))
        return ctx.replyWithMarkdown(ctx.i18n.t('select_a_gym'), Markup.keyboard(ctx.session.gymbtns)
          .oneTime()
          .resize().extra())
          .then(() => ctx.wizard.next())
      }
    },

    // step 8: handle gym selection
    async (ctx) => {
      const gymIndex = ctx.session.gymbtns.indexOf(ctx.update.message.text)
      const selectedGym = ctx.session.gymcandidates[gymIndex]
      if (selectedGym.id === 0) {
        // mmm, let's try searching for a gym again
        return ctx.replyWithMarkdown(ctx.i18n.t('edit_raid_search_gym_again'), Markup.removeKeyboard().extra())
          .then(() => {
            ctx.wizard.selectStep(6)
            return ctx.wizard.steps[6](ctx)
          })
      } else {
        ctx.session.newgymid = selectedGym.id
        ctx.session.editraid.gymId = selectedGym.id
        ctx.session.editraid.gymname = selectedGym.gymname
        ctx.wizard.selectStep(4)
        return ctx.wizard.steps[4](ctx)
      }
    }
  )
}
async function sendRaidbosses (ctx, bot) {
  const raidbossId = ctx.session.editraid.bossid
  if (!raidbossId) {
    return
  }
  const gymname = ctx.session.editraid.gymname
  const target = ctx.session.editraid.target
  const starttime = ctx.session.editraid.start1

  await sendRaidbossNotifications(ctx, bot, raidbossId, gymname, target, starttime)
}

module.exports = EditRaidWizard

// ===================
// add gym wizard
// ===================
const WizardScene = require('telegraf/scenes/wizard')
const { Markup } = require('telegraf')
var models = require('../models')
const adminCheck = require('../util/adminCheck')

function AddGymWizard (bot) {
  return new WizardScene('add-gym-wizard',
    // Step 0
    // Gym name
    async (ctx) => {
      const invalidAdmin = await adminCheck(ctx, bot)
      if (invalidAdmin !== false) {
        return invalidAdmin
      }

      ctx.session.newgym = {}
      return ctx.replyWithMarkdown(`Je wilt een nieuwe gym toevoegen.\n*Voer de naam in…*`, Markup.removeKeyboard())
        .then(() => ctx.wizard.next())
    },
    // Step 1
    // Adres of x
    async (ctx) => {
      let gymname = ctx.update.message.text.trim()
      let user = ctx.update.message.from
      // check if exists
      let oldgyms = await models.Gym.findAll({
        where: {
          gymname: gymname
        }
      })
      if (oldgyms.length > 0) {
        return ctx.replyWithMarkdown(`Deze gym bestaat al…\n*Je kunt nu weer terug naar de groep gaan. Wil je nog een actie uitvoeren? Klik dan hier op */start`, Markup.removeKeyboard().extra())
          .then(() => ctx.scene.leave())
      }
      ctx.session.newgym.reporterName = user.first_name
      ctx.session.newgym.reporterId = user.id
      ctx.session.newgym.gymname = gymname
      ctx.replyWithMarkdown('*Wat is het adres (straat en eventueel nummer)?*\nAls je deze niet weet, vul een *x* in…', Markup.removeKeyboard().extra())
        .then(() => ctx.wizard.next())
    },
    // Step 2
    // Google maps of x
    async (ctx) => {
      let gymadres = ctx.update.message.text.trim()
      ctx.session.newgym.address = gymadres.toLowerCase() === 'x' ? null : gymadres
      ctx.replyWithMarkdown(`Top!\n*Kan je een Google Maps link geven?* \n\n[Hulp bij het maken van een Google Maps link](https://dev.romeen.nl/pogo_googlemaps/)\n Als je deze link niet kunt geven, verstuur dan een letter *x*…`)
        .then(() => ctx.wizard.next())
    },
    // Step 3
    // Exraid vraag ja/nee, weet niet
    async (ctx) => {
      let gmlink = ctx.update.message.text.trim()
      gmlink = gmlink.toLowerCase() === 'x' ? null : gmlink
      ctx.session.newgym.googleMapsLink = gmlink
      if (gmlink !== null && gmlink.substr(0, 4) !== 'http') {
        ctx.replyWithMarkdown(`Geen geldige link. Links starten met 'http'. \n*Probeer nog eens.*`)
          .then(() => ctx.wizard.back())
      }
      ctx.session.exraidbtns = [`Ja`, `Nee / Weet ik niet`]
      ctx.replyWithMarkdown(`Okidoki…\nIs dit een kanshebber voor een ExRaid?`, Markup.keyboard(ctx.session.exraidbtns)
        .resize().oneTime().extra())
        .then(() => ctx.wizard.next())
    },
    // Step 4
    // toon samenvatting & bevestiging
    async (ctx) => {
      let exraid = ctx.session.exraidbtns.indexOf(ctx.update.message.text) === 0
      ctx.session.newgym.exRaidTrigger = exraid
      ctx.session.savebtns = ['Ja', 'Nee']
      return ctx.replyWithMarkdown(`Bijna klaar!\nJe hebt deze gegevens ingevuld:\nNieuwe gym: *${ctx.session.newgym.gymname}*\nAdres: ${ctx.session.newgym.address === null ? 'Niet opgegeven' : ctx.session.newgym.address}\nKaart: ${ctx.session.newgym.googleMapsLink === null ? 'Niet opgegeven' : ctx.session.newgym.googleMapsLink}\nEX Raid kanshebber: ${ctx.session.newgym.exRaidTrigger ? 'Ja' : 'Nee / weet niet'}\n\n*Opslaan?*`, Markup.keyboard(ctx.session.savebtns).resize().oneTime().extra())
        .then(() => ctx.wizard.next())
    },
    // Step 5
    async (ctx) => {
      // save …or maybe not
      let savenow = ctx.session.savebtns.indexOf(ctx.update.message.text) === 0
      if (savenow) {
        let gym = models.Gym.build(ctx.session.newgym)
        try {
          await gym.save()
        } catch (error) {
          console.log('Whoops… saving new gym failed', error)
          return ctx.replyWithMarkdown(`Sorry, hier ging iets *niet* goed… Wil je het nog eens proberen met /start?\n*Of je kan ook weer terug naar de groep gaan…*`, Markup.removeKeyboard().extra())
            .then(() => ctx.scene.leave())
        }
        return ctx.replyWithMarkdown('Dankjewel!\n*Je kunt nu weer terug naar de groep gaan. Wil je nog een actie uitvoeren? Klik dan hier op */start', Markup.removeKeyboard().extra())
          .then(() => ctx.scene.leave())
      } else {
        return ctx.replyWithMarkdown('OK. *Je kunt nu weer terug naar de groep gaan. Wil je nog een actie uitvoeren? Klik dan hier op */start', Markup.removeKeyboard().extra())
          .then(() => ctx.scene.leave())
      }
    })
}
module.exports = AddGymWizard

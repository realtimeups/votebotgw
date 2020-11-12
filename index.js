const Discord = require("discord.js");
const config = require("./botconfig.json");
const Poll = require("./poll.js");
const Datastore = require('nedb');

const client = new Discord.Client();

const commandSyntaxRegex = new RegExp(`^${config.prefix}\\s(((time=\\d+([smhd]?\\s))?("[^"\\n]+"\\s?){1,11})|(help)|(examples)|(end\\s\\d+)|(invite))$`);

// two pre-generated embeds
const helpEmbed = new Discord.RichEmbed()
	.setAuthor("VotaBot's Commands")
	.addField("Create Y/N poll", `\`${config.prefix} "Question"\``)
	.addField("Create complex poll [2-10 answers]", `\`${config.prefix} "Question" "Option 1" "Option 2" ["Option 3" ...]\` (quotes are necessary)`)
	.addField("Timed polls that close automatically", `\`${config.prefix} time=X{s|m|h|d} ...\`, where "X" is the time to finish the
		poll followed by it's unit.`)
	.addField("See results of a poll and close the voting", `\`${config.prefix} end ID\`, where ID is the poll id wich
		appears at the end of the poll`)
	.addField("See examples", `\`${config.prefix} examples\``)
	.addBlankField()
	.addField("About", "greenwich vote bot. join us [here](httpa://discord.gg/greenwich).")
	.setColor("#DDA0DD")
	.setFooter('TimeUpS', 'https://i.ibb.co/vJNGCjb/TimeUpS.jpg');

const helpMessage = `**Things to know**.
-Only administrators or people with a role named "Poll Creator" can interact with me.
-Polls are only stored for a week, you can't retrieve the results from an older poll (also applies to timed polls).
-If for some unlucky reason the bot restarts, in the current version you won't have the option of finishing any poll created before.
-Use " not two '.
-There is a 10 seconds max error for timed polls.`;

const examplesEmbed = new Discord.RichEmbed()
	.setAuthor("Examples of VotaBot's commands")
	.addField("Y/N Poll", `\`${config.prefix} "Do you like this?"\``)
	.addField("Complex poll", `\`${config.prefix} "What do you wanna play?" "Overwatch" "CS:GO" "Quake" "WoW"\``)
	.addField("Timed poll", `\`${config.prefix} time=6h "Chat tonight?"\``)
	.addField("See the results of a poll", `\`${config.prefix} end 61342378\``)
	.setColor("#DDA0DD")
	.setFooter('TimeUpS', 'https://i.ibb.co/vJNGCjb/TimeUpS.jpg');

let database = new Datastore('database.db');
database.loadDatabase();
database.persistence.setAutocompactionInterval(3600000);

async function finishTimedPolls() {
	const now = Date.now()
	database.find({ isTimed: true, finishTime: { $lte: now } }, (err, dbps) => {
		if (err) console.error(err);

		dbps.forEach((dbp) => {
			const p = Poll.copyConstructor(dbp);

			if (p instanceof Poll && p.isTimed && p.finishTime <= now) {
				p.finish(client);
				database.remove({ id: p.id });
			}
		});
	});
}

async function poll(msg, args) {
	const timeToVote = await parseTime(msg, args);

	const question = args.shift();
	let answers = [];
	let type;

	switch (args.length) {
		case 0:
			answers = ["", ""];
			type = "yn";
			break;
		case 1:
			msg.reply("You cannot create a poll with only one answer");
			return;
		default:
			answers = args;
			type = "default";
			break;
	}

	const p = await new Poll(msg, question, answers, timeToVote, type);

	await p.start(msg);

	if (p.hasFinished == false) {
		database.insert(p);
		// maybe we can get a duplicated id...
	}
}

async function end(msg, args) {
	const inputid = Number(args[1]);

	database.findOne({ id: inputid }, (err, dbp) => {
		if (err) { console.errror(err); }
		if (dbp) {
			const p = Poll.copyConstructor(dbp);
			if (!p.hasFinished && p.guildId === msg.guild.id) {
				p.finish(client)
				database.remove({ id: p.id });
			}
		} else {
			msg.reply("Cannot find the poll.");
		}
	});
}

function parseTime(msg, args) {
	let time = 0;

	//parse the time limit if it exists
	if (args[0].startsWith("time=")) {
		const timeRegex = /\d+/;
		const unitRegex = /s|m|h|d/i;
		let timeString = args.shift();
		let unit = "s";

		let match;

		// check if the time is correct
		match = timeString.match(timeRegex);
		if (match != null) {
			time = parseInt(match.shift());
		} else {
			msg.reply("Wrong time syntax!");
			return;
		}

		// check the units of the time
		match = timeString.split("=").pop().match(unitRegex);
		if (match != null) unit = match.shift();

		switch (unit) {
			case "s": time *= 1000;
				break;
			case "m": time *= 60000;
				break;
			case "h": time *= 3600000;
				break;
			case "d": time *= 86400000;
				break;
			default: time *= 60000;
		}
	}

	if (time > 604800000) return 604800000; // no more than a week.
	else return time;
}

function parseToArgs(msg) {
	let args = msg.content.slice(config.prefix.length)
		.trim()
		.split("\"")
		.filter((phrase) => phrase.trim() !== "");
	for (let i = 0; i < args.length; i++)
		args[i] = args[i].trim();
	if (args[0].startsWith("end")) {
		let aux = args[0].split(" ");
		args[0] = aux[0];
		args.push(aux[1]);
	}
	return args;
}

function cleanDatabase() {
	console.log("Cleaning the database...");
	const aWeekAgo = Date.now() - 604800000;
	database.remove({ createdOn: { $lt: aWeekAgo } }, { multi: true }, (err, n) => console.log(n + " entries removed."));
}

client.on("ready", () => {
	console.log(`Bot logged in as ${client.user.tag}!`);
	client.user.setActivity(`${config.prefix} help`);

	setInterval(finishTimedPolls, 10000); // 10s
	setInterval(cleanDatabase, 86400000); // 24h

	setInterval(() => console.log("The bot is in " + client.guilds.size + " guild(s)"), 1800000); // logging info
});

client.on("message", async (msg) => {
	if (msg.content.startsWith(config.prefix) && !msg.author.bot) {
		// if its a guild, check permissions
		let isDM = false, dmChannel;
		if (msg.channel.type === "text" || msg.channel.type === "news") {
			let role;
			let roleid = -1;
			try {
				role = await msg.guild.roles.find((r) => r.name === "Developer");
				if (role) roleid = role.id;
			} catch (error) {
				console.error(error);
			}

			if (!(msg.member.hasPermission("ADMINISTRATOR") || msg.member.roles.has(roleid))) {
				msg.reply("You don't have permision to do that. Only administrators or users with a role named \"Poll Creator\"");
				console.log(`${msg.author.tag} on ${msg.guild.name} tried to create a poll without permission"`);
				return;
			}
		} else {
			isDM = true;
		}

		if (msg.content.match(commandSyntaxRegex)) {
			let args = parseToArgs(msg);
			if (args.length > 0) {
				console.log(`${args[0]} executed in ${msg.guild ? msg.guild.name : (msg.author.username + "'s DMs")} by ${msg.author.tag}`);
				switch (args[0]) {
					case "help":
						dmChannel = await msg.author.createDM();
						await dmChannel.send({ embed: helpEmbed });
						dmChannel.send(helpMessage);
						break;
					case "examples":
						dmChannel = await msg.author.createDM();
						dmChannel.send({ embed: examplesEmbed });
						break;
					case "end":
						if (!isDM) {
							end(msg, args);
						}
						break;
					case "invite":
						if (config.link) {
							msg.reply(`This is the link to invite me to another server! ${config.link}`);
						} else {
							msg.reply("The link is not available in this moment.");
						}
						break;
					default:
						if (!isDM) {
							poll(msg, args);
						}
						break;
				}
			} else {
				msg.reply("Sorry, give me more at least a question");
			}
		} else msg.reply(`Wrong command syntax. Learn how to do it correctly with \`${config.prefix} help\``);
	}
});

client.on("error", console.error);

client.login(process.env.TOKEN).then((TOKEN) => console.log("Logged in successfully")).catch(console.error);
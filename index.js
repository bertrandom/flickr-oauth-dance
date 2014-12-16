#!/usr/bin/env node

var chrome = require('chrome-cookies-secure'),
	request = require('request'),
	cheerio = require('cheerio'),
	url = require('url'),
	OAuth = require('oauth').OAuth,
	inquirer = require("inquirer"),
	spinner = require("char-spinner"),
	fs = require('fs'),
	path = require('path'),
	mkdirp = require('mkdirp');

function createApp(jar, callback) {

	var dir,
		dirName,
		baseName,
		question;

	var dir = process.cwd();
	baseName = path.basename(dir);

	if (baseName === 'flickr-oauth-dance') {
		baseName = null;
	}

	question = {
		type: 'input',
		name: 'appName',
		message: 'What\'s the name of your app?',
		validate: function(input) {

			var done = this.async();
			if (!input) {
				done("A name for your app is required.");
				return;
			}

			done(true);

		}
	};

	if (baseName) {
		question.default = baseName;
	}

	inquirer.prompt([question,{
		type: 'input',
		name: 'appDescription',
		message: 'What are you building?',
		validate: function(input) {

			var done = this.async();
			if (!input) {
				done("A description for your app is required.");
				return;
			}

			done(true);

		}
	}], function(answers) {

		var interval = spinner();

		request({ url: 'https://www.flickr.com/services/apps/create/apply/', jar: jar }, function (err, response, body) {
			request({ url: 'https://www.flickr.com/services/apps/create/noncommercial/', jar: jar }, function (err, response, body) {

				$ = cheerio.load(body);

				var postFields = {};

				$('#frm-app-submit input').each(function(index, node) {

					var type = $(node).attr('type');

					if (type === 'hidden' || type === 'checkbox') {
						postFields[$(node).attr('name')] = $(node).attr('value');
					}

				});

				postFields.app_name = answers.appName;
				postFields.app_description = answers.appDescription;

				request.post({
					url: 'https://www.flickr.com/services/apps/create/noncommercial/',
					form: postFields,
					jar: jar
				}, function (err, response, body) {

					$ = cheerio.load(body);

					var appUrl = $('a.app_link').attr('href');
					var matches = appUrl.match(/\/services\/apps\/([0-9]*)\//);

					var app = {
						id: matches[1],
						key: $('span.api-key-info').eq(0).text(),
						secret: $('span.api-key-info').eq(1).text(),
					};

					clearInterval(interval);

					callback(null, app);

				});

			});
		});

	});

}

function getAccessToken(app, jar, callback) {

	var oa = new OAuth("http://www.flickr.com/services/oauth/request_token",
	  "http://www.flickr.com/services/oauth/access_token",
	  app.key,
	  app.secret,
	  "1.0A",
	  "http://localhost/callback",
	  "HMAC-SHA1");

	inquirer.prompt([{
		type: 'list',
		name: 'perms',
		message: 'What permissions would you like to grant the app?',
		default: 'read',
		choices: [{name: 'read', value: 'read'}, {name: 'read, write', value: 'write'}, {name: 'read, write, delete', value: 'delete'}]
	}], function(answers) {

		var interval = spinner();

		oa.getOAuthRequestToken(function(error, oauthToken, oauthTokenSecret, results) {

			request({url: "https://www.flickr.com/services/oauth/authorize?oauth_token=" + oauthToken + '&perms=' + answers.perms, jar: jar}, function(err, response, body) {

				$ = cheerio.load(body);

				var postFields = {};

				$('#permissions form input').each(function(index, node) {

					var type = $(node).attr('type');

					if (type === 'hidden' || type === 'checkbox') {
						postFields[$(node).attr('name')] = $(node).attr('value');
					}

				});

				request.post({
					url: 'https://www.flickr.com/services/oauth/authorize.gne',
					form: postFields,
					jar: jar,
					followRedirect: false
				}, function (err, response, body) {
					
					var location = response.headers.location;
					var parsedUrl = url.parse(location, true);

					oa.getOAuthAccessToken(oauthToken, oauthTokenSecret, parsedUrl.query.oauth_verifier, function(error, oauth_access_token, oauth_access_token_secret, results) {

						var config = {
							api_key: app.key,
							api_secret: app.secret,
							access_token: oauth_access_token,
							access_token_secret: oauth_access_token_secret,
							user_nsid: results.user_nsid,
							username: results.username
						};

						clearInterval(interval);

						callback(null, config);

					});

				});

			});

		});

	});

}

function getExistingApps(jar, callback) {

	var interval = spinner();

	request({ url: 'https://www.flickr.com/services/apps/by/me', jar: jar }, function (err, response, body) {

		$ = cheerio.load(body);

		var postFields = {};

		var apps = {};

		$('div.app-summary-details').each(function(index, node) {

			var link,
				text,
				matches,
				app = {};

			link = $(node).find('a.app-summary-app-link');

			app.name = link.text();
			matches = link.attr('href').match(/\/services\/apps\/([0-9]*)\//);
			app.id = matches[1];

			text = $(node).find('div.app-summary-api-stats').text();

			matches = text.match(/Key: ([0-9a-z]*)/);
			app.key = matches[1];

			matches = text.match(/Secret: ([0-9a-z]*)/);
			app.secret = matches[1];

			apps[app.id] = app;

		});

		clearInterval(interval);

		callback(null, apps);

	});

}

function chooseExistingApp(jar, callback) {

	getExistingApps(jar, function(err, apps) {

		if (Object.keys(apps).length === 0) {
			console.log('No apps found.');
			return;
		}

		var choices = [];

		for (var appId in apps) {

			var app = apps[appId];

			choices.push({
				name: app.name,
				value: app.id
			});

		}

		inquirer.prompt([{
			type: 'list',
			name: 'appId',
			message: 'Choose an existing app',
			choices: choices
		}], function(answers) {

			callback(null, apps[answers.appId]);

		});


	});

}

function chooseCreateOrExisting(callback) {

	inquirer.prompt([{
		type: 'list',
		name: 'action',
		message: 'Choose one:',
		default: 'create',
		choices: [{name: 'Create a new app', value: 'create'}, {name: 'Select an existing app', value: 'existing'}]
	}], function(answers) {

		callback(null, answers.action);

	});

}

function testLogin(jar, callback) {

	request({ url: 'https://www.flickr.com/me', jar: jar, followRedirect: false }, function (err, response, body) {

		if (err) {
			return callback(err);
		}

		var parsedUrl = url.parse(response.headers.location);

		if (parsedUrl.pathname === '/signin/') {
			return callback(null, (parsedUrl.pathname !== '/signin/'));
		}

		var matches = parsedUrl.pathname.match(/\/photos\/(.*)\//);
		var nsidOrPathAlias = matches[1];

		callback(null, true, nsidOrPathAlias);

	});

}

function chooseOutput(callback) {

	inquirer.prompt([{
		type: 'list',
		name: 'action',
		message: 'What would you like to do with the config?',
		default: 'stdout',
		choices: [{name: 'Display it now', value: 'stdout'}, {name: 'Write to a file', value: 'file'}]
	}], function(answers) {

		callback(null, answers.action);

	});

}

function getFilename(callback) {

	inquirer.prompt([{
		type: 'input',
		name: 'filename',
		message: 'Filename',
		default: 'config/local.json'
	}], function(answers) {

		callback(null, answers.filename);

	});

}

module.exports = {
	createApp: createApp,
	getAccessToken: getAccessToken,
	getExistingApps: getExistingApps,
	chooseExistingApp: chooseExistingApp,
	chooseCreateOrExisting: chooseCreateOrExisting,
	testLogin: testLogin,
	chooseOutput: chooseOutput,
	getFilename: getFilename
}
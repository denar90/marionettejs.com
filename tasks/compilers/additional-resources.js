var Promise    = require('bluebird');
var fs         = Promise.promisifyAll(require('fs'));
var mkdirp     = Promise.promisify(require('mkdirp'));
var rimraf     = Promise.promisify(require('rimraf'));
var mv         = Promise.promisify(require('mv'));
var path       = require('path');
var https      = require('https');
var _          = require('underscore');
var request    = require('request');
var GitHubApi  = require('github');
var CONSTS     = require('../consts');
var dotEnv     = require('dotenv').config();

var Compiler = function(paths) {
  /**
   * Compiler constants
   */
  this.VIDEOS_TYPE = CONSTS.AR.TOPICS[2].TYPE;
  this.EXAMPLES_TYPE = CONSTS.AR.TOPICS[3].TYPE;

  this.github = new GitHubApi();

  this.paths = paths;
};

_.extend(Compiler.prototype, {
  /**
   * Compiles
   */
  compile: function () {
    return Promise.bind(this)
      .then(this.setup)
  },

  /**
   * Setups data
   */
  setup: function () {
    return Promise.all([
      mkdirp(this.paths.output)
    ]).bind(this)
      .then(function() {
        var resUrl = this.paths.resUrl;
        return new Promise(function(resolve, reject) {
          https.get(resUrl, function(response) {
            var buffer = '';
            response.on('data', function(chunk) {
              buffer += chunk;
            });
            response.on('end', function(err) {
              if (err) {
                reject(err);
              }
              resolve(buffer);
            });
          });
        });
      })
      .then(this.writeDataFiles)
  },

  /**
   * Writes data to files
   * @param {string} data
   */
  writeDataFiles: function (data) {
    var resourcesSections = this.getResourcesSections(data);
    return Promise.map(resourcesSections, function(value, index) {
      //path where file will be saved
      var distPath = path.join(this.paths.output, CONSTS.AR.TOPICS[index].FILE_NAME);
      //get file data
      var fileData = this.listToArray(value);
      switch(CONSTS.AR.TOPICS[index].TYPE) {
        case this.VIDEOS_TYPE:
          var videoIds = this.getVideoIds(fileData);
          //get parsed video data from youtube
          return this.getYouTubeData(videoIds).then(function(data) {
            return fs.writeFileSync(distPath, JSON.stringify(data, null, 4));
          });
        case this.EXAMPLES_TYPE:
          var urlRepos = _.pluck(fileData, 'url');
          var repos = this.getUserRepoNames(urlRepos);
          //get parsed data from github
          return this.getGithubReposData(repos).then(function(data) {
            return fs.writeFileSync(distPath, JSON.stringify(data, null, 4));
          });
        default:
          return fs.writeFileSync(distPath, JSON.stringify(fileData, null, 4));
      }
    }.bind(this));
  },

  /**
   * Builds regexp for parsing resources
   * @returns {string}
   */
  buildRegExpForResources: function () {
    //pattern has to be like: '(##\\sGeneral|##\\sTutorials and articles)([^##]*)'
    return '(##\\\s' + _.pluck(CONSTS.AR.TOPICS, 'TITLE').join('|##\\\s') + ')([^##]*)';
  },

  /**
   * Gets resources divided by sections
   * @param {string} data
   * @returns {Array}
   */
  getResourcesSections: function (data) {
    var myRegExp = new RegExp(this.buildRegExpForResources(), 'gm');
    return data.match(myRegExp);
  },

  /**
   * Gets video ids from video url
   * @param {Object} videoData
   * @returns {Array}
   */
  getVideoIds: function (videoData) {
    return _.map(videoData, function(value, index) {
      var regExp = /(?:https?:\/{2})?(?:w{3}\.)?youtu(?:be)?\.(?:com|be)(?:\/watch\?v=|\/)([^\s&]+)/;
      try {
        return regExp.exec(value.url)[1];
      } catch(e) {
        //error
      }
    });
  },

  /**
   * Makes array of object from list data
   * @param {string} data
   * @returns {Array}
   *
   * Example
   * - [Building Backbone Plugins](https://leanpub.com/building-backbone-plugins) by Derick Bailey and Jerome Gravel-Niquet
   * - [Backbone.Marionette.js: A Gentle Introduction](https://leanpub.com/marionette-gentle-introduction) by David Sulc
   * - [Structuring Backbone Code with RequireJS and Marionette Modules](https://leanpub.com/structuring-backbone-with-requirejs-and-marionette) by David Sulc
   * - [Marionette Exposé](https://leanpub.com/marionetteexpose) by Jack Killilea
   * - [Backbone.Marionette.js: A Serious Progression](https://leanpub.com/marionette-serious-progression) by David Sulc
   * - [Getting Started with Backbone Marionette](http://www.amazon.com/dp/1783284250/) by Raymundo Armendariz and Arturo Soto
   * - [Marionette guides](https://www.gitbook.com/book/marionette/marionette-guides/details)
   *
   * Result
   * [
   *  {
   *    title: 'Building Backbone Plugins',
   *    link: 'https://leanpub.com/building-backbone-plugins'
   *  },
   *  {
   *    title: 'Backbone.Marionette.js: A Gentle Introduction',
   *    link: 'https://leanpub.com/marionette-gentle-introduction'
   *  }
   *
   *  etc.....
   *
   * ]
   */
  listToArray: function (data) {
    var regExp = /\[([^\]]+)\]\(([^)]+)\)/ig;
    var myRegExp = new RegExp(regExp);
    var execData = data.match(myRegExp);
    var linksDataArray = [];
    for(var i = 0; i <= execData.length; i++) {
      myRegExp = new RegExp(regExp);
      var link = myRegExp.exec(execData[i]);
      if (link) {
        var linkData = {
          title: link[1],
          url: link[2]
        };
        linksDataArray.push(linkData);
      }
    }
    return linksDataArray;
  },

  /**
   * Gets videos data using youtube API
   * @param {Array} videoIds
   * @returns {Promise}
   */
  getYouTubeData: function (videoIds) {
    var ids = videoIds.join();
    var resUrl = 'https://www.googleapis.com/youtube/v3/videos?id=' + ids + '&key=' + CONSTS.AR.API_KEY + '&part=snippet';
    return new Promise(function (resolve, reject) {
      request(resUrl, function (error, response, body) {
        if (error) {
          reject(err);
        }
        resolve(JSON.parse(response.body));
      });
    }).then(function(data) {
      return _.map(data.items, function(item) {
        return {
          title        : item.snippet.title,
          id           : item.id,
          channelTitle : item.snippet.channelTitle,
          img          : item.snippet.thumbnails.medium.url
        };
      });
    });
  },

  /**
   * Gets guthub repo data
   * @param {Array} repos
   * @returns {Promise}
   */
  getGithubReposData: function (repos) {
    this.githubAuth();

    return Promise.map(repos, function(repo, index) {
      return new Promise(function (resolve, reject) {
        this.github.repos.get({
          user: repo.split('/')[0],
          repo: repo.split('/')[1]
        }, function (err, res) {
          if (err) reject(err);

          resolve(res);
        });
      }.bind(this)).then(function(data) {
        var description = data.description || data.html_url;

        if (data.owner) {
          return {
            avatar_url: data.owner.avatar_url,
            url: data.html_url,
            description: description
          };
        }
      });
    }.bind(this));
  },

  /**
   * Auths to github with process env credentials
   */
  githubAuth: function() {
    this.github.authenticate({
      type: 'oauth',
      token: process.env.AUTH_TOKEN
    });
  },

  /**
   * Gets guthub username&reponame from urls
   * @param {Array} repos
   * @returns {Array}
   */
  getUserRepoNames: function (repos) {
    return _.map(repos, function(repo) {
      return /https:\/\/github\.com\/([^#]*)/g.exec(repo)[1];
    });
  }
});

module.exports = Compiler;

var Promise      = require('bluebird');
var EventEmitter = require('events').EventEmitter;
var _            = require('underscore');
var fs           = Promise.promisifyAll(require('fs'));
var path         = require('path');
var gitty        = require('gitty');
var mkdirp       = Promise.promisify(require('mkdirp'));
var rimraf       = Promise.promisify(require('rimraf'));
var marked       = require('marked');
var highlight    = require('highlight.js');
var mv           = Promise.promisify(require('mv'));
var validTags    = require('./utils/tags').valid;
var GittyCache   = require('./utils/gitty-cache');
var CONSTS       = require('./consts');

var renderer = new marked.Renderer();

renderer.heading = function(text, level, raw) {
  var escapedText = raw
    .toLowerCase()
    .replace(/['\.:]/g, '') // Add edge cases: /[1\.A]/g
    .replace(/[^\w|$|\/]+/g, '-') // Characters not to dasherize
    .replace(/\/|^-|-$/g, ''); // Clean up

  return (
    '<h'+level+'>'+
      '<a name="'+escapedText+'" class="anchor" href="#'+escapedText+'">'+
        '<span class="header-link"></span>'+
      '</a>'+
      text+
    '</h'+level+'>'
  );
};

marked.setOptions({
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false,
  highlight: function (code, lang) {
    return highlight.highlightAuto(code, [lang]).value;
  }
});

var Compiler = function(paths) {
  this.paths = paths;
  this.repo = Promise.promisifyAll(gitty(this.paths.repo));
};

Compiler.prototype = new EventEmitter();

_.extend(Compiler.prototype, {
  compile: function() {
    return Promise.bind(this)
      .then(this.setup)
      .then(this.readFiles)
      .then(this.writeFiles)
      .then(this.writeTagIndexes)
      .then(this.cleanup);
  },

  setup: function() {
    return Promise.all([
      fs.readFileAsync(this.paths.template).call('toString'),
      fs.readFileAsync(this.paths.indexTemplate).call('toString'),
      fs.readFileAsync(this.paths.svgIcons).call('toString'),
      mkdirp(this.paths.tmp),
      GittyCache.getSortedTags(this.repo)
    ]).bind(this).spread(function(template, indexTemplate, svgIcons, dir, tags) {
      this.template = _.template(template);
      this.indexTemplate = _.template(indexTemplate);
      this.svgIcons = svgIcons;
      this.tmpDir   = dir;
      this.tags     = tags;
      this.branch   = 'master';
    });
  },

  compileContents: function(contents) {
    var compiledContents = marked(contents, { renderer: renderer });

    // Strip out view the docs headline from each doc
    compiledContents = compiledContents.replace(/<h2\>.*View the new docs.*<\/h2>/, '');

    // Attempts to replace extension of content links to other documents
    compiledContents = compiledContents.replace(/.md/g, '.html');

    return compiledContents;
  },

  getPageTitle: function(compiledContents) {
    var pageTitle;

    // Grab the text inside the 1st <h1>
    pageTitle = compiledContents.match(/<h1>([\s\S]*?)<\/h1>/)[1];

    // Remove all other tags
    pageTitle = pageTitle.replace(/<[^>]*>|Marionette./g, '');

    //capitalize 1st letter
    return pageTitle.charAt(0).toUpperCase() + pageTitle.slice(1);
  },

  getPageDescription: function(compiledContents) {
    // Blanket assumption that the first paragraph is
    // suitable for a short description.
    var description = compiledContents.match(/<p>([\s\S]*?)<\/p>/)[1];

    return description
      // force translation of breaks to a space
      .replace(/<br>/g, ' ')
      // remove remaining tags
      .replace(/\<[^\>]*\>/g, '');
  },

  readFiles: function() {
    return Promise.bind(this).return(this.tags.concat(this.branch)).map(function(tag) {
      return this.repo.checkoutAsync(tag).bind(this).then(function() {
        return fs.readdirAsync(this.paths.src);
      }).filter(function(filename) {
        // first we want to extract only markdown files
        return path.extname(filename) === '.md';
      }).filter(function(filename) {
        // Omit files that are blacklisted
        return CONSTS.BLACKLIST_FILES.indexOf(path.basename(filename)) == -1;
      })
      .map(function(filename) {
        var src = path.resolve(this.paths.src, filename);
        return fs.readFileAsync(src).bind(this).then(function(contents) {
          var compiled = this.compileContents(contents.toString());
          var basename = path.basename(filename, '.md');
          var title = this.getPageTitle(compiled);
          var description = this.getPageDescription(compiled);

          this.emit('readFile', { file: src });
          return {
            tag      : tag,
            basename : basename,
            filename : filename,
            pathname : path.resolve(this.paths.tmp, tag),
            contents : compiled,
            title    : title || basename,
            description: description
          };
        });
      })
      .catch(function(err) {
        return false;
      });
    }, { concurrency: 1 })
    .then(function(files) {
      // If we failed to read the md files for a version omit that version
      return _.filter(files, function(f){return f});
    })
    .then(function(files) {
      //sort files
      this.files = files.map(function(files) {
        var topics = _.filter(files, function(value, index) {
          return CONSTS.TOPICS.indexOf(value.filename) >= 0;
        });
        var casualDocs = _.filter(files, function(value, index) {
          return CONSTS.TOPICS.indexOf(value.filename) == -1;
        });
        var sortedTopics = _.sortBy(topics, function(obj) {
          return _.indexOf(CONSTS.TOPICS, obj.filename);
        });
        return sortedTopics.concat(casualDocs);
      });
    });
  },

  // Write out markup for each tag index page
  writeTagIndexes: function() {
    return Promise.bind(this)
      .then(function(){
        GittyCache.getReleaseTag(this.repo)
      })
      .return(this.files).map(function(files) {
        var indexPath = path.resolve(files[0].pathname, "index.html")
        var indexContentMarkup = this.indexTemplate({
          tags    : validTags(this.tags),
          tag     : files[0].tag,
          file    : files[0],
          files   : files
        });

        var indexMarkup = this.template({
          content : indexContentMarkup,
          svgIcons: this.svgIcons,
          tags    : validTags(this.tags),
          tag     : files[0].tag,
          file    : files[0],
          files   : files
        });

        // If this is the latest release ensure to write the /docs/current file
        if (files[0].tag == this.branch) {
          return fs.writeFileAsync(indexPath, indexMarkup)
          .then(function() {
            var currentPath = path.resolve(files[0].pathname, '../current/');
            var currentIndex = path.resolve(currentPath, 'index.html');
            return mkdirp(currentPath).bind(this).then(function() {
                return fs.writeFileAsync(currentIndex, indexMarkup);
              });
          });
        }

        return fs.writeFileAsync(indexPath, indexMarkup);
      });
  },

  writeFiles: function() {
    return Promise.bind(this).return(this.files).map(function(files) {
      return Promise.bind(this).return(files).map(function(file) {
        file.contents = this.template({
          content : file.contents,
          svgIcons: this.svgIcons,
          tags    : validTags(this.tags).concat(this.branch),
          tag     : files[0].tag,
          file    : file,
          files   : files
        });

        return mkdirp(file.pathname).bind(this).then(function() {
          this.emit('mkdirp', { dir: file.pathname });
        }).return(file);
      }).each(function(file) {
        var dest = path.resolve(file.pathname, file.basename + '.html');
        return fs.writeFileAsync(dest, file.contents).bind(this).then(function() {
          this.emit('writeFile', { file: dest });
        });
      })
      .then(function(files) {
        // Guard clause.. skip unless latest release
        if (files[0].tag != this.branch) {
          return;
        }

        return Promise.map(files, function(file) {
          // Split off the version tag to write the most recent version to
          // /docs/....
          var dest = path.resolve(
            file.pathname.split("/").slice(0, -1).join('/'),
            file.basename + '.html'
          );

          return fs.writeFileAsync(dest, file.contents);
        });
      })
    });
  },

  cleanup: function() {
    var tmpDir = path.resolve(this.paths.tmp, '..');
    return Promise.bind(this).then(function() {
      return rimraf(this.paths.dest);
    }).then(function() {
      this.emit('rimraf', { dir: this.paths.dest });
      return mkdirp(path.resolve(this.paths.dest, '..'));
    }).then(function() {
      this.emit('mkdirp', { dir: this.paths.dest });
      return fs.symlinkAsync(this.paths.tmp, this.paths.dest);
    }).then(function() {
      this.emit('symlink', { from: this.paths.tmp, to: this.paths.dest });
      return fs.readdirAsync(tmpDir);
    }).filter(function(dir) {
      dir = path.resolve(tmpDir, dir);
      return fs.statAsync(dir).bind(this).then(function(stats) {
        return stats.isDirectory() && dir !== this.paths.tmp;
      });
    }).map(function(dir) {
      dir = path.resolve(tmpDir, dir);
      return rimraf(dir).bind(this).then(function() {
        this.emit('rimraf', { dir: dir });
      });
    });
  },

  finializeBuild: function() {
    return rimraf(this.paths.dest)
    .then(function() {
      this.emit('mv', { from: this.tmpDir, to: this.paths.dest });
      return mv(this.paths.tmp, this.paths.dest, {mkdirp: true})
    }.bind(this))
  }
});

module.exports = function(grunt) {
  grunt.registerMultiTask('compileDocs', function() {
    var options   = this.options();
    var files     = this.files[0];

    var compiler  = new Compiler({
      repo     : path.resolve(options.repo),
      template : path.resolve(options.template),
      indexTemplate : path.resolve(options.indexTemplate),
      svgIcons : path.resolve(options.svgIcons),
      tmp      : path.resolve('./.grunt/compileDocs/' + Date.now()),
      src      : path.resolve(files.orig.src[0]),
      dest     : path.resolve(files.dest)
    });

    compiler.on('readFile', function(data) {
      grunt.verbose.writeln('readFile: ' + data.file);
    });

    compiler.on('mkdirp', function(data) {
      grunt.verbose.writeln('mkdirp: ' + data.dir);
    });

    compiler.on('writeFile', function(data) {
      grunt.verbose.writeln('writeFile: ' + data.file);
    });

    compiler.on('symlink', function(data) {
      grunt.verbose.writeln('symlink: from ' + data.from + ' to ' + data.to);
    });

    compiler.on('rimraf', function(data) {
      grunt.verbose.writeln('writeFile: ' + data.file);
    });

    compiler.on('mv', function(data) {
      grunt.verbose.writeln('moving: ' + JSON.stringify(data));
    });

    compiler.compile()
    .then(function() {
      return compiler.finializeBuild();
    })
    .then(function() {
      compiler.removeAllListeners();
      grunt.log.ok('Success!');
    })
    .then(this.async());
  });
};

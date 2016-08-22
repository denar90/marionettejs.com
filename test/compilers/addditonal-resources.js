const test      = require('ava');
const path      = require('path');
const _         = require('underscore');
const fs        = require('fs');
const dataMochs = require('./_mochs');
const Compiler  = require('../../tasks/compilers/additional-resources');

const fixtures = {
  VIDEOS: '../fixtures/videos.md',
  BOOKS: '../fixtures/books.md',
  EXAMPLES: '../fixtures/examples.md'
};

const compiler = new Compiler();

test('Convert text list to JSON', async t => {
  const fileData = await fs.readFileSync(fixtures.BOOKS, 'utf8');
  const parsedFileData = compiler.listToArray(fileData);
  t.deepEqual(parsedFileData, dataMochs.parsedFileData);
});

test('Convert video links to ids', async t => {
  const fileData = await fs.readFileSync(fixtures.VIDEOS, 'utf8');
  const parsedFileData = compiler.listToArray(fileData);
  const videoIds = compiler.getVideoIds(parsedFileData);
  t.deepEqual(videoIds, dataMochs.videoIds);
});

test('Get youtube data', async t => {
  const fileData = await fs.readFileSync(fixtures.VIDEOS, 'utf8');
  const parsedFileData = compiler.listToArray(fileData);
  const videoIds = compiler.getVideoIds(parsedFileData);
  const videoData = await compiler.getYouTubeData(videoIds);
  t.deepEqual(videoData, dataMochs.videoData);
});

test('Get guthub username&reponame from urls', async t => {
  const fileData = await fs.readFileSync(fixtures.EXAMPLES, 'utf8');
  const parsedFileData = compiler.listToArray(fileData);
  const urlRepos = _.pluck(parsedFileData, 'url');
  const githubRepos = compiler.getUserRepoNames(urlRepos);
  t.deepEqual(githubRepos, dataMochs.githubRepos);
});

test('Get github data', async t => {
  const fileData = await fs.readFileSync(fixtures.EXAMPLES, 'utf8');
  const parsedFileData = compiler.listToArray(fileData);
  const urlRepos = _.pluck(parsedFileData, 'url');
  const githubRepos = compiler.getUserRepoNames(urlRepos);
  const examplesData = await compiler.getGithubReposData(githubRepos);
  t.deepEqual(examplesData, dataMochs.examplesData);
});
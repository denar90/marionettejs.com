;(function() {
  function setListeners() {
    document.getElementById('version-dropdown').onchange = function() {
      window.location = '/docs/' + this.value;
    };
  }

  setListeners();

  var currentFile = window.location.pathname.split('/').pop();

  var currentNav = document.querySelectorAll('a[href$="' + currentFile + '"]')[0];

  if (currentNav) {
    currentNav.className += ' is-selected';
  }

})();

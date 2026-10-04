App.onglets.push({
  id: 'courses',
  titre: 'Courses',
  icone: '<path d="M3 4h2l2.5 11h10L20 8H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  rendre: function (c) {
    c.innerHTML = App.ecranVide('La liste de courses',
      'Elle se remplira toute seule à partir du planning, sans doublons, avec un budget estimé.');
  }
});

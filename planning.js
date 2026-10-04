App.onglets.push({
  id: 'planning',
  titre: 'Planning',
  icone: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  rendre: function (c) {
    c.innerHTML = App.ecranVide('La semaine à table',
      'Ici, vous placerez les plats du midi et du soir, et les gamelles du lendemain.');
  }
});

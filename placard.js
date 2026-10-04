App.onglets.push({
  id: 'placard',
  titre: 'Placard',
  icone: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14M9 6v2M9 13v3"/>',
  rendre: function (c) {
    c.innerHTML = App.ecranVide('Placard et frigo',
      'Ce que vous avez déjà ne sera pas ajouté à la liste de courses.');
  }
});

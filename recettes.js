App.onglets.push({
  id: 'recettes',
  titre: 'Recettes',
  icone: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
  rendre: function (c) {
    c.innerHTML = App.ecranVide('Vos recettes',
      'Les recettes par catégorie, avec temps de préparation, cuisson et valeurs nutritives.');
  }
});

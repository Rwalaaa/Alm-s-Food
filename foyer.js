App.onglets.push({
  id: 'foyer',
  titre: 'Foyer',
  icone: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  rendre: function (c, ctx) {
    var h = App.h;
    var membres = ctx.membres.map(function (m) {
      return '<li>' + h(m.prenom) + (m.user_id === ctx.moi.user_id ? ' <span class="discret">(toi)</span>' : '') + '</li>';
    }).join('');
    var seul = ctx.membres.length < 2;

    c.innerHTML =
      '<section class="bloc">' +
        '<h2>' + h(ctx.foyer.nom) + '</h2>' +
        '<ul class="membres">' + membres + '</ul>' +
      '</section>' +
      '<section class="bloc">' +
        '<h2>Code d\'invitation</h2>' +
        '<p>' + (seul
          ? 'Donne ce code à l\'autre personne du foyer : elle le saisira à sa première connexion.'
          : 'Ce code permet de rejoindre le foyer depuis un autre compte.') + '</p>' +
        '<div class="code" id="code-invitation">' + h(ctx.foyer.code_invitation) + '</div>' +
        '<button class="bouton secondaire" id="copier-code" type="button">Copier le code</button>' +
      '</section>' +
      '<section class="bloc">' +
        '<p class="discret">Connecté avec ' + h(ctx.email) + '</p>' +
        '<button class="bouton secondaire" id="deconnexion" type="button">Se déconnecter</button>' +
      '</section>';

    c.querySelector('#copier-code').addEventListener('click', function (e) {
      var bouton = e.currentTarget;
      var fini = function () { bouton.textContent = 'Code copié'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ctx.foyer.code_invitation).then(fini, function () {});
      }
    });
    c.querySelector('#deconnexion').addEventListener('click', ctx.deconnecter);
  }
});

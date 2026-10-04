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
      '<section class="bloc" id="bloc-magasins"><h2>Magasins</h2><p class="chargement">Chargement…</p></section>' +
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
    App.magasins(c.querySelector('#bloc-magasins'), ctx);
  }
});

// Magasins : écart de prix avec les prix de référence (coefficient 0,85 = 15 % moins cher)
(function () {
  var h = App.h;
  var ECARTS = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30];
  var etat = { liste: [], nbPrix: 0, erreur: '', occupe: false };

  function pourcent(coef) { return Math.round((Number(coef) - 1) * 100); }
  App.texteEcart = function (coef) {
    var p = pourcent(coef);
    if (p === 0) return 'aux prix de référence';
    return Math.abs(p) + ' % ' + (p < 0 ? 'moins cher' : 'plus cher');
  };
  function options(pc) {
    var liste = ECARTS.indexOf(pc) === -1 ? ECARTS.concat([pc]).sort(function (a, b) { return a - b; }) : ECARTS;
    return liste.map(function (e) {
      return '<option value="' + e + '"' + (e === pc ? ' selected' : '') + '>' + (e === 0 ? '0 %' : (e > 0 ? '+' : '−') + Math.abs(e) + ' %') + '</option>';
    }).join('');
  }
  function affiche(bloc) {
    return bloc.isConnected && !!document.querySelector('.onglet[data-onglet="foyer"][aria-current="page"]');
  }

  function rendre(bloc, ctx) {
    bloc.innerHTML = '<h2>Magasins</h2>' +
      '<p>' + (etat.nbPrix ? etat.nbPrix + ' ingrédients ont un prix de référence, estimé sur une grande surface moyenne. ' : '') +
        'Indique l\'écart de chaque magasin : le budget de la liste en tiendra compte.</p>' +
      (etat.erreur ? '<p class="erreur" role="alert">' + h(etat.erreur) + '</p>' : '') +
      (etat.liste.length ? '<ul class="magasins">' + etat.liste.map(function (m) {
        return '<li><span class="magasin-nom">' + h(m.nom) + '<small>' + h(App.texteEcart(m.coefficient)) + '</small></span>' +
          '<select data-ecart="' + h(m.id) + '" aria-label="Écart de prix pour ' + h(m.nom) + '">' + options(pourcent(m.coefficient)) + '</select>' +
          '<button type="button" class="form-suppr" data-suppr="' + h(m.id) + '" aria-label="Retirer ' + h(m.nom) + '">Retirer</button></li>';
      }).join('') + '</ul>' : '') +
      '<div class="magasin-ajout"><input id="magasin-nom" maxlength="40" placeholder="Ex. : Lidl Péronne" aria-label="Nom du magasin">' +
        '<select id="magasin-ecart" aria-label="Écart de prix">' + options(0) + '</select>' +
        '<button type="button" class="bouton" id="magasin-ajouter">Ajouter</button></div>';

    bloc.querySelector('#magasin-ajouter').addEventListener('click', function () { ajouter(bloc, ctx); });
    bloc.querySelector('#magasin-nom').addEventListener('keydown', function (e) { if (e.key === 'Enter') ajouter(bloc, ctx); });
    bloc.querySelectorAll('[data-ecart]').forEach(function (s) {
      s.addEventListener('change', function () { modifier(bloc, ctx, s.dataset.ecart, Number(s.value)); });
    });
    bloc.querySelectorAll('[data-suppr]').forEach(function (b) {
      b.addEventListener('click', function () { retirer(bloc, ctx, b.dataset.suppr); });
    });
  }

  async function ecrire(bloc, ctx, requete) {
    if (etat.occupe) return;
    etat.occupe = true;
    var r = await requete;
    etat.occupe = false;
    etat.erreur = r.error ? (/duplicate key/.test(r.error.message || '') ? 'Ce magasin existe déjà.' : App.traduireErreur(r.error)) : '';
    return charger(bloc, ctx, r.error ? null : true);
  }
  function ajouter(bloc, ctx) {
    var nom = bloc.querySelector('#magasin-nom').value.trim();
    if (!nom) return;
    var coef = 1 + Number(bloc.querySelector('#magasin-ecart').value) / 100;
    return ecrire(bloc, ctx, ctx.sb.from('magasins').insert({ nom: nom, coefficient: coef }));
  }
  function modifier(bloc, ctx, id, pc) {
    return ecrire(bloc, ctx, ctx.sb.from('magasins').update({ coefficient: 1 + pc / 100 }).eq('id', id));
  }
  function retirer(bloc, ctx, id) {
    var m = etat.liste.find(function (x) { return x.id === id; });
    if (!m || !window.confirm('Retirer ' + m.nom + ' ? Les prix relevés dans ce magasin seront effacés.')) return;
    return ecrire(bloc, ctx, ctx.sb.from('magasins').delete().eq('id', id));
  }

  async function charger(bloc, ctx, garderNom) {
    var saisie = garderNom === null && bloc.querySelector('#magasin-nom') ? bloc.querySelector('#magasin-nom').value : '';
    var res = await Promise.all([
      ctx.sb.from('magasins').select('id, nom, coefficient').order('nom'),
      ctx.sb.from('prix').select('ingredient_id').eq('source', 'reference')
    ]);
    if (res[0].error || res[1].error) etat.erreur = App.traduireErreur(res[0].error || res[1].error);
    else {
      etat.liste = res[0].data || [];
      var vus = {};
      (res[1].data || []).forEach(function (p) { vus[p.ingredient_id] = true; });
      etat.nbPrix = Object.keys(vus).length;
    }
    if (!affiche(bloc)) return;
    rendre(bloc, ctx);
    if (saisie) bloc.querySelector('#magasin-nom').value = saisie;   // en cas d'erreur, on ne perd pas la saisie
  }

  App.magasins = function (bloc, ctx) { etat.erreur = ''; return charger(bloc, ctx); };
})();

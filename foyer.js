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
      '<section class="bloc" id="bloc-gouts"><h2>Goûts</h2><p class="chargement">Chargement…</p></section>' +
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
    App.gouts(c.querySelector('#bloc-gouts'), ctx);
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

// Goûts : ce que chacun aime ou n'aime pas (table preferences). Chacun modifie les siens, voit ceux des autres.
(function () {
  var h = App.h;
  var etat = { prefs: [], ingredients: [], texte: '', erreur: '', occupe: false };

  function affiche(bloc) {
    return bloc.isConnected && !!document.querySelector('.onglet[data-onglet="foyer"][aria-current="page"]');
  }
  function nomDe(id) {
    var i = etat.ingredients.find(function (x) { return x.id === id; });
    return i ? i.nom : '?';
  }
  function triNoms(liste) { return liste.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); }); }
  function avisDe(userId, avis) {
    return triNoms(etat.prefs.filter(function (p) { return p.user_id === userId && p.avis === avis; })
      .map(function (p) { return { id: p.ingredient_id, nom: nomDe(p.ingredient_id) }; }));
  }
  function puces(liste, modifiable, avis) {
    if (!liste.length) return '<p class="discret gouts-vide">Rien pour l\'instant.</p>';
    return '<ul class="gouts-puces">' + liste.map(function (x) {
      return '<li class="gout-' + avis + '">' + h(x.nom) + (modifiable
        ? '<button type="button" data-retirer="' + h(x.id) + '" aria-label="Retirer ' + h(x.nom) + '">×</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function suggestions(moi) {
    var t = App.simplifier(etat.texte.trim());
    if (!t) return '';
    var res = etat.ingredients.filter(function (i) { return App.simplifier(i.nom).indexOf(t) !== -1; }).slice(0, 6);
    if (!res.length) return '<p class="discret">Aucun ingrédient de ce nom dans vos recettes.</p>';
    return '<ul class="gouts-sugg">' + res.map(function (i) {
      var p = etat.prefs.find(function (x) { return x.user_id === moi && x.ingredient_id === i.id; });
      return '<li><span>' + h(i.nom) + '</span>' +
        '<button type="button" class="puce" data-avis="aime_pas" data-ingr="' + h(i.id) + '" aria-pressed="' + (!!p && p.avis === 'aime_pas') + '">Je n\'aime pas</button>' +
        '<button type="button" class="puce" data-avis="aime" data-ingr="' + h(i.id) + '" aria-pressed="' + (!!p && p.avis === 'aime') + '">J\'aime</button></li>';
    }).join('') + '</ul>';
  }

  function rendre(bloc, ctx) {
    var moi = ctx.moi.user_id;
    var autres = ctx.membres.filter(function (m) { return m.user_id !== moi; });
    bloc.innerHTML = '<h2>Goûts</h2>' +
      '<p>Les plats avec un ingrédient que quelqu\'un n\'aime pas passent en fin de liste quand vous choisissez un repas.</p>' +
      (etat.erreur ? '<p class="erreur" role="alert">' + h(etat.erreur) + '</p>' : '') +
      '<h3>Tu n\'aimes pas</h3>' + puces(avisDe(moi, 'aime_pas'), true, 'aime_pas') +
      '<h3>Tu aimes</h3>' + puces(avisDe(moi, 'aime'), true, 'aime') +
      '<label class="gouts-ajout">Ajouter un ingrédient<input id="gouts-texte" type="search" autocomplete="off" maxlength="50" placeholder="Ex. : poivron" value="' + h(etat.texte) + '"></label>' +
      '<div id="gouts-sugg">' + suggestions(moi) + '</div>' +
      autres.map(function (m) {
        var pas = avisDe(m.user_id, 'aime_pas'), oui = avisDe(m.user_id, 'aime');
        return '<div class="gouts-autre"><h3>' + h(m.prenom) + '</h3>' +
          (!pas.length && !oui.length ? '<p class="discret">' + h(m.prenom) + ' n\'a encore rien indiqué.</p>'
            : (pas.length ? '<p class="discret">N\'aime pas</p>' + puces(pas, false, 'aime_pas') : '') +
              (oui.length ? '<p class="discret">Aime</p>' + puces(oui, false, 'aime') : '')) + '</div>';
      }).join('');

    var champ = bloc.querySelector('#gouts-texte');
    champ.addEventListener('input', function () {
      etat.texte = champ.value;
      bloc.querySelector('#gouts-sugg').innerHTML = suggestions(moi);
    });
  }

  // Un seul écouteur par bloc (le contenu du bloc est redessiné à chaque modification)
  function brancher(bloc, ctx) {
    var moi = ctx.moi.user_id;
    bloc.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || etat.occupe || !bloc.contains(b)) return;
      if (b.dataset.retirer) return ecrire(bloc, ctx, ctx.sb.from('preferences').delete().eq('user_id', moi).eq('ingredient_id', b.dataset.retirer));
      if (b.dataset.avis) {
        var p = etat.prefs.find(function (x) { return x.user_id === moi && x.ingredient_id === b.dataset.ingr; });
        if (p && p.avis === b.dataset.avis)   // déjà choisi : un second appui retire l'avis
          return ecrire(bloc, ctx, ctx.sb.from('preferences').delete().eq('user_id', moi).eq('ingredient_id', b.dataset.ingr));
        return ecrire(bloc, ctx, ctx.sb.from('preferences')
          .upsert({ user_id: moi, ingredient_id: b.dataset.ingr, avis: b.dataset.avis }, { onConflict: 'user_id,ingredient_id' }));
      }
    });
  }

  async function ecrire(bloc, ctx, requete) {
    etat.occupe = true;
    bloc.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var r = await requete;
    etat.occupe = false;
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    return charger(bloc, ctx);
  }

  async function charger(bloc, ctx) {
    var res = await Promise.all([
      ctx.sb.from('preferences').select('user_id, ingredient_id, avis'),
      ctx.sb.from('ingredients').select('id, nom').order('nom')
    ]);
    if (res[0].error || res[1].error) etat.erreur = App.traduireErreur(res[0].error || res[1].error);
    else { etat.prefs = res[0].data || []; etat.ingredients = res[1].data || []; }
    if (!affiche(bloc)) return;
    var focus = document.activeElement && document.activeElement.id === 'gouts-texte';
    rendre(bloc, ctx);
    if (focus) bloc.querySelector('#gouts-texte').focus();
  }

  App.gouts = function (bloc, ctx) { etat.erreur = ''; etat.texte = ''; brancher(bloc, ctx); return charger(bloc, ctx); };
})();

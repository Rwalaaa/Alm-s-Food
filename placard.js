// Onglet Placard : ce qu'on a déjà à la maison (table stock).
// Quantité vide = « on en a » : l'ingrédient sort de la liste de courses.
// Quantité notée = déduite de ce qu'il faut acheter. Toujours à la maison = placard de base.
(function () {
  var h = App.h;
  var ZONES = [['frigo', 'Frigo'], ['congelateur', 'Congélateur'], ['placard', 'Placard']];
  var UNITES = { g: 'g', ml: 'ml', piece: 'pièce(s)' };
  var etat = { stock: [], catalogue: [], texte: '', edition: null, erreur: '', occupe: false };

  // ---------- Textes ----------
  function nomZone(z) { var t = ZONES.find(function (x) { return x[0] === z; }); return t ? t[1] : z; }
  App.quantiteStock = function (q, unite) {
    if (q == null || q === '') return '';
    q = Number(q);
    if (unite === 'piece') return q.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + (q > 1 ? ' pièces' : ' pièce');
    return App.quantiteCourses(q, unite);
  };
  App.noteDepuis = function (horodatage) {   // jours entiers en heure locale
    var d = new Date(horodatage), a = App.aujourdhui();
    var n = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (n <= 0) return "noté aujourd'hui";
    if (n === 1) return 'noté hier';
    return 'noté il y a ' + n + ' j';
  };

  // ---------- Données ----------
  async function charger(sb) {
    var res = await Promise.all([
      sb.from('stock').select('ingredient_id, zone, permanent, quantite, maj_le'),
      sb.from('ingredients').select('id, nom, rayon, unite_base').order('nom')
    ]);
    for (var k = 0; k < res.length; k++) if (res[k].error) throw res[k].error;
    etat.catalogue = res[1].data || [];
    var parId = {};
    etat.catalogue.forEach(function (i) { parId[i.id] = i; });
    etat.stock = (res[0].data || []).filter(function (s) { return parId[s.ingredient_id]; })
      .map(function (s) { return Object.assign({}, s, { ingredient: parId[s.ingredient_id] }); });
  }
  function afficheeMaintenant() { return !!document.querySelector('.onglet[data-onglet="placard"][aria-current="page"]'); }

  // ---------- Affichage ----------
  function rendre(c, ctx) {
    var html = etat.erreur ? '<p class="erreur bandeau" role="alert">' + h(etat.erreur) + '</p>' : '';
    if (etat.edition) {
      html += editeur(etat.edition);
    } else {
      html += '<div class="placard-ajout"><input type="search" id="placard-texte" class="rec-recherche" autocomplete="off" maxlength="50" ' +
        'placeholder="Ajouter : riz, oignons, lait…" aria-label="Ajouter un ingrédient" value="' + h(etat.texte) + '">' +
        '<div id="placard-sugg">' + suggestions() + '</div></div>';
      html += liste();
    }
    c.innerHTML = html;
    brancher(c, ctx);
  }

  function suggestions() {
    var t = App.simplifier(etat.texte.trim());
    if (!t) return '';
    var deja = {};
    etat.stock.forEach(function (s) { deja[s.ingredient_id] = true; });
    var trouves = etat.catalogue.filter(function (i) { return App.simplifier(i.nom).indexOf(t) !== -1; });
    var libres = trouves.filter(function (i) { return !deja[i.id]; }).slice(0, 6);
    if (!libres.length) {
      return '<p class="discret placard-aucun">' + (trouves.length ? 'Déjà noté plus bas.' :
        'Aucun ingrédient « ' + h(etat.texte.trim()) + ' ». Les nouveaux ingrédients se créent depuis une recette.') + '</p>';
    }
    return '<ul class="suggestions">' + libres.map(function (i) {
      return '<li><button type="button" data-choisir="' + h(i.id) + '">' + h(i.nom) + '</button></li>';
    }).join('') + '</ul>';
  }

  function liste() {
    if (!etat.stock.length) {
      return App.ecranVide('Rien de noté pour l\'instant',
        'Note ce que vous avez déjà : ces ingrédients ne seront pas ajoutés à la liste de courses.');
    }
    var tri = function (a, b) { return a.ingredient.nom.localeCompare(b.ingredient.nom, 'fr'); };
    var html = '';
    ZONES.forEach(function (z) {
      var items = etat.stock.filter(function (s) { return !s.permanent && s.zone === z[0]; }).sort(tri);
      if (items.length) html += section(z[1], '', items, false);
    });
    var base = etat.stock.filter(function (s) { return s.permanent; }).sort(tri);
    if (base.length) html += section('Toujours à la maison', 'Jamais ajouté à la liste de courses.', base, true);
    return html;
  }

  function section(titre, aide, items, permanent) {
    return '<section class="rayon"><h2>' + h(titre) + '</h2>' + (aide ? '<p class="placard-aide">' + h(aide) + '</p>' : '') +
      '<ul class="placard-liste">' + items.map(function (s) {
        var q = App.quantiteStock(s.quantite, s.ingredient.unite_base);
        var detail = permanent ? nomZone(s.zone) : App.noteDepuis(s.maj_le);
        return '<li><button type="button" class="placard-item" data-modifier="' + h(s.ingredient_id) + '">' +
          '<span class="article-nom">' + h(s.ingredient.nom) + '<small>' + h(detail) + '</small></span>' +
          '<span class="' + (q ? 'article-qte' : 'placard-on-en-a') + '">' + h(q || 'on en a') + '</span></button></li>';
      }).join('') + '</ul></section>';
  }

  function editeur(E) {
    return '<div class="editeur-ingr placard-editeur">' +
      '<p class="editeur-nom">' + h(E.nom) + '</p>' +
      '<div class="bascule placard-zones" role="radiogroup" aria-label="Où ?">' + ZONES.map(function (z) {
        return '<button type="button" role="radio" data-zone="' + z[0] + '" aria-checked="' + (E.zone === z[0]) + '">' + z[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="case placard-case"><input type="checkbox" id="placard-permanent"' + (E.permanent ? ' checked' : '') + '>' +
        '<span>Toujours à la maison <span class="discret">(placard de base : sel, huile…)</span></span></label>' +
      (E.permanent ? '' :
        '<label class="placard-qte"><span>Quantité <span class="discret">(facultatif)</span></span>' +
        '<span class="champ-unite"><input id="placard-quantite" type="number" inputmode="decimal" min="0" step="any" value="' + h(E.quantite) + '">' +
        '<span>' + UNITES[E.unite_base] + '</span></span>' +
        '<small class="discret">Vide = on en a assez, l\'ingrédient sort de la liste. Notée = déduite de ce qu\'il faut acheter.</small></label>') +
      '<p class="erreur" role="alert" id="placard-erreur" hidden></p>' +
      '<div class="editeur-boutons">' +
        '<button type="button" class="bouton secondaire" id="placard-annuler">Annuler</button>' +
        '<button type="button" class="bouton" id="placard-enregistrer">' + (E.nouveau ? 'Ajouter' : 'Enregistrer') + '</button>' +
      '</div>' +
      (E.nouveau ? '' : '<button type="button" class="form-suppr placard-retirer" id="placard-retirer">Retirer du placard</button>') +
    '</div>';
  }

  // ---------- Événements ----------
  function brancher(c, ctx) {
    var champ = c.querySelector('#placard-texte');
    if (champ) champ.addEventListener('input', function () {
      etat.texte = champ.value;
      c.querySelector('#placard-sugg').innerHTML = suggestions();
      brancherSuggestions(c, ctx);
    });
    brancherSuggestions(c, ctx);
    c.querySelectorAll('[data-modifier]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = etat.stock.find(function (x) { return x.ingredient_id === b.dataset.modifier; });
        if (s) ouvrirEditeur(c, ctx, s.ingredient, s);
      });
    });
    if (!etat.edition) return;
    c.querySelectorAll('[data-zone]').forEach(function (b) {
      b.addEventListener('click', function () { lireEditeur(c); etat.edition.zone = b.dataset.zone; rendre(c, ctx); });
    });
    c.querySelector('#placard-permanent').addEventListener('change', function () { lireEditeur(c); rendre(c, ctx); });
    c.querySelector('#placard-annuler').addEventListener('click', function () { etat.edition = null; rendre(c, ctx); });
    c.querySelector('#placard-enregistrer').addEventListener('click', function () { enregistrer(c, ctx); });
    var q = c.querySelector('#placard-quantite');
    if (q) q.addEventListener('keydown', function (e) { if (e.key === 'Enter') enregistrer(c, ctx); });
    var r = c.querySelector('#placard-retirer');
    if (r) r.addEventListener('click', function () { retirer(c, ctx); });
  }

  function brancherSuggestions(c, ctx) {
    c.querySelectorAll('[data-choisir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = etat.catalogue.find(function (x) { return x.id === b.dataset.choisir; });
        if (i) ouvrirEditeur(c, ctx, i, null);
      });
    });
  }

  function ouvrirEditeur(c, ctx, ing, s) {
    etat.erreur = '';
    etat.edition = {
      id: ing.id, nom: ing.nom, unite_base: ing.unite_base, nouveau: !s,
      zone: s ? s.zone : (ing.rayon === 'cremerie' || ing.rayon === 'boucherie' || ing.rayon === 'poissonnerie' ? 'frigo' : ing.rayon === 'surgeles' ? 'congelateur' : 'placard'),
      permanent: s ? s.permanent : false,
      quantite: s && s.quantite != null ? String(Number(s.quantite)) : ''
    };
    rendre(c, ctx);
    if (window.scrollTo) try { window.scrollTo(0, 0); } catch (e) { /* jsdom */ }
  }

  function lireEditeur(c) {
    var E = etat.edition;
    E.permanent = c.querySelector('#placard-permanent').checked;
    var q = c.querySelector('#placard-quantite');
    if (q) E.quantite = q.value;
  }

  function montrerErreur(c, texte) {
    var p = c.querySelector('#placard-erreur');
    if (p) { p.textContent = texte; p.hidden = !texte; }
  }

  // ---------- Actions ----------
  async function enregistrer(c, ctx) {
    if (etat.occupe) return;
    lireEditeur(c);
    var E = etat.edition, quantite = null;
    if (!E.permanent && String(E.quantite).trim() !== '') {
      quantite = Number(String(E.quantite).replace(',', '.'));
      if (!isFinite(quantite) || quantite <= 0) return montrerErreur(c, 'Quantité invalide : mets un nombre positif, ou laisse vide.');
    }
    var champs = { zone: E.zone, permanent: E.permanent, quantite: quantite, maj_le: new Date().toISOString() };
    etat.occupe = true;
    c.querySelector('#placard-enregistrer').disabled = true;
    var r = E.nouveau
      ? await ctx.sb.from('stock').insert(Object.assign({ ingredient_id: E.id }, champs))
      : await ctx.sb.from('stock').update(champs).eq('ingredient_id', E.id);
    etat.occupe = false;
    if (r.error && !/duplicate key/.test(r.error.message || '')) {   // doublon : l'autre téléphone l'a noté entre-temps
      if (afficheeMaintenant()) { c.querySelector('#placard-enregistrer').disabled = false; montrerErreur(c, App.traduireErreur(r.error)); }
      return;
    }
    etat.edition = null;
    etat.texte = '';
    etat.erreur = r.error ? 'Cet ingrédient était déjà noté sur l\'autre téléphone : vérifie la ligne.' : '';
    return recharger(c, ctx);
  }

  async function retirer(c, ctx) {
    if (etat.occupe) return;
    etat.occupe = true;
    var r = await ctx.sb.from('stock').delete().eq('ingredient_id', etat.edition.id);
    etat.occupe = false;
    if (r.error) { if (afficheeMaintenant()) montrerErreur(c, App.traduireErreur(r.error)); return; }
    etat.edition = null;
    return recharger(c, ctx);
  }

  async function recharger(c, ctx) {
    if (!etat.stock.length && !etat.catalogue.length) c.innerHTML = '<p class="chargement">Ouverture du placard…</p>';
    try { await charger(ctx.sb); }
    catch (err) {
      if (!afficheeMaintenant()) return;
      c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
        '<button type="button" class="bouton secondaire" id="placard-reessayer">Réessayer</button>';
      c.querySelector('#placard-reessayer').addEventListener('click', function () { recharger(c, ctx); });
      return;
    }
    if (afficheeMaintenant()) rendre(c, ctx);
  }

  App.onglets.push({
    id: 'placard',
    titre: 'Placard',
    icone: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14M9 6v2M9 13v3"/>',
    rendre: function (c, ctx) {
      etat.edition = null; etat.texte = ''; etat.erreur = '';
      c.innerHTML = '<p class="chargement">Ouverture du placard…</p>';
      return recharger(c, ctx);
    }
  });
})();

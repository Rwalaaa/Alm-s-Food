// Démarrage de l'appli : connexion -> foyer -> onglets
(function () {
  var h = App.h;
  var racine = document.getElementById('app');
  var sb = null;
  var etat = { session: null, moi: null, foyer: null, membres: [], onglet: App.lire('onglet', 'planning') };

  // ---------- Aiguillage ------------------------------------------------
  async function aiguiller(session) {
    etat.session = session;
    if (!session) return afficherConnexion();
    try {
      await chargerFoyer();
    } catch (err) {
      return afficherErreurGlobale(err);
    }
    if (!etat.moi) return afficherChoixFoyer();
    afficherAppli();
  }

  async function chargerFoyer() {
    var uid = etat.session.user.id;
    var r = await sb.from('membres').select('user_id, foyer_id, prenom').order('rejoint_le');
    if (r.error) throw r.error;
    etat.membres = r.data || [];
    etat.moi = etat.membres.find(function (m) { return m.user_id === uid; }) || null;
    etat.foyer = null;
    if (etat.moi) {
      var f = await sb.from('foyers').select('id, nom, code_invitation').eq('id', etat.moi.foyer_id).single();
      if (f.error) throw f.error;
      etat.foyer = f.data;
    }
  }

  // ---------- Écrans hors appli -----------------------------------------
  function cadre(contenu) {
    return '<div class="accueil"><div class="vichy" aria-hidden="true"></div>' +
      '<div class="accueil-corps"><h1 class="marque">À table</h1>' + contenu + '</div></div>';
  }

  function afficherConnexion() {
    racine.innerHTML = cadre(
      '<form id="form-connexion" class="formulaire" novalidate>' +
        '<label>E-mail<input type="email" name="email" autocomplete="username" required></label>' +
        '<label>Mot de passe<input type="password" name="mdp" autocomplete="current-password" required></label>' +
        '<p class="erreur" role="alert" hidden></p>' +
        '<button class="bouton" type="submit">Se connecter</button>' +
      '</form>');
    var form = racine.querySelector('#form-connexion');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim(), mdp = form.elements.mdp.value;
      if (!email || !mdp) return montrerErreur(form, 'Saisis ton e-mail et ton mot de passe.');
      occupe(form, true);
      var r = await sb.auth.signInWithPassword({ email: email, password: mdp });
      occupe(form, false);
      if (r.error) return montrerErreur(form, App.traduireErreur(r.error));
      aiguiller(r.data.session);
    });
  }

  function afficherChoixFoyer() {
    racine.innerHTML = cadre(
      '<p class="intro">Première connexion : crée le foyer, ou rejoins-le si l\'autre personne l\'a déjà créé.</p>' +
      '<div class="bascule" role="tablist">' +
        '<button type="button" role="tab" data-mode="creer" aria-selected="true">Créer le foyer</button>' +
        '<button type="button" role="tab" data-mode="rejoindre" aria-selected="false">J\'ai un code</button>' +
      '</div>' +
      '<form id="form-foyer" class="formulaire" novalidate>' +
        '<label class="champ-creer">Nom du foyer<input name="nom" placeholder="La maison" maxlength="40"></label>' +
        '<label class="champ-rejoindre" hidden>Code d\'invitation<input name="code" autocapitalize="characters" ' +
          'autocomplete="off" maxlength="12" placeholder="8 caractères"></label>' +
        '<label>Ton prénom<input name="prenom" autocomplete="given-name" maxlength="30"></label>' +
        '<p class="erreur" role="alert" hidden></p>' +
        '<button class="bouton" type="submit">Créer le foyer</button>' +
      '</form>' +
      '<button type="button" class="lien" id="deco">Changer de compte</button>');

    var form = racine.querySelector('#form-foyer');
    var mode = 'creer';
    racine.querySelectorAll('.bascule button').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.dataset.mode;
        racine.querySelectorAll('.bascule button').forEach(function (x) {
          x.setAttribute('aria-selected', String(x === b));
        });
        form.querySelector('.champ-creer').hidden = mode !== 'creer';
        form.querySelector('.champ-rejoindre').hidden = mode !== 'rejoindre';
        form.querySelector('button[type=submit]').textContent = mode === 'creer' ? 'Créer le foyer' : 'Rejoindre le foyer';
        montrerErreur(form, '');
      });
    });
    racine.querySelector('#deco').addEventListener('click', deconnecter);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var prenom = form.elements.prenom.value.trim();
      var r;
      if (!prenom) return montrerErreur(form, 'Saisis ton prénom.');
      occupe(form, true);
      if (mode === 'creer') {
        var nom = form.elements.nom.value.trim() || 'La maison';
        r = await sb.rpc('creer_foyer', { p_nom: nom, p_prenom: prenom });
      } else {
        var code = form.elements.code.value.trim();
        if (!code) { occupe(form, false); return montrerErreur(form, 'Saisis le code d\'invitation.'); }
        r = await sb.rpc('rejoindre_foyer', { p_code: code, p_prenom: prenom });
      }
      occupe(form, false);
      if (r.error) return montrerErreur(form, App.traduireErreur(r.error));
      aiguiller(etat.session);
    });
  }

  function afficherErreurGlobale(err) {
    racine.innerHTML = cadre(
      '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
      '<button class="bouton" type="button" id="reessayer">Réessayer</button>');
    racine.querySelector('#reessayer').addEventListener('click', function () { aiguiller(etat.session); });
  }

  // ---------- Appli -------------------------------------------------------
  function afficherAppli() {
    if (!App.onglets.some(function (o) { return o.id === etat.onglet; })) etat.onglet = App.onglets[0].id;
    racine.innerHTML =
      '<div class="appli">' +
        '<header class="entete"><div class="entete-int"><p class="salut" id="salut"></p><h1 id="titre-onglet"></h1></div></header>' +
        '<main id="contenu" class="contenu"></main>' +
        '<nav class="barre" aria-label="Onglets">' +
          App.onglets.map(function (o) {
            return '<button type="button" class="onglet" data-onglet="' + h(o.id) + '">' +
              App.icone(o.icone) + '<span>' + h(o.titre) + '</span></button>';
          }).join('') +
        '</nav>' +
      '</div>';
    racine.querySelectorAll('.onglet').forEach(function (b) {
      b.addEventListener('click', function () { ouvrir(b.dataset.onglet); });
    });
    ouvrir(etat.onglet);
  }

  // « Bonjour Xixi » de 5 h à 18 h, « Bonsoir Xixi » sinon (lot 15b)
  function salutation() {
    var heure = (App.aujourdhui ? App.aujourdhui() : new Date()).getHours();
    var mot = heure >= 5 && heure < 18 ? 'Bonjour' : 'Bonsoir';
    return etat.moi && etat.moi.prenom ? mot + ' ' + etat.moi.prenom : mot;
  }

  function ouvrir(id) {
    var o = App.onglets.find(function (x) { return x.id === id; });
    if (!o) return;
    etat.onglet = id;
    App.ecrire('onglet', id);
    racine.querySelector('#titre-onglet').textContent = o.titre;
    racine.querySelector('#salut').textContent = salutation();
    racine.querySelectorAll('.onglet').forEach(function (b) {
      if (b.dataset.onglet === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var c = racine.querySelector('#contenu');
    c.innerHTML = '';
    c.scrollTop = 0;
    o.rendre(c, {
      sb: sb,
      foyer: etat.foyer,
      membres: etat.membres,
      moi: etat.moi,
      email: etat.session.user.email,
      deconnecter: deconnecter
    });
  }

  // ---------- Outils --------------------------------------------------------
  async function deconnecter() {
    etat.session = null; etat.moi = null; etat.foyer = null; etat.membres = [];
    await sb.auth.signOut();
    aiguiller(null);
  }

  function montrerErreur(form, texte) {
    var p = form.querySelector('.erreur');
    p.textContent = texte;
    p.hidden = !texte;
  }

  function occupe(form, oui) {
    var b = form.querySelector('button[type=submit]');
    b.disabled = oui;
    form.setAttribute('aria-busy', String(oui));
  }

  // ---------- Lancement ----------------------------------------------------
  App.demarrer = async function (client) {
    sb = client || window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseCle);
    App.sb = sb;
    sb.auth.onAuthStateChange(function (evenement) {
      if (evenement === 'SIGNED_OUT' && etat.session) aiguiller(null);
    });
    var r = await sb.auth.getSession();
    aiguiller(r.data && r.data.session);
  };

  if (!window.APP_TEST) {
    if (!window.supabase || !window.CONFIG || /VOTRE-PROJET/.test(CONFIG.supabaseUrl)) {
      racine.innerHTML = '<p class="chargement">Configuration manquante : remplis js/config.js.</p>';
    } else {
      App.demarrer();
    }
  }
})();

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase.js";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap');`;

const STATUSES = ["Reçue", "En préparation", "En livraison", "Livrée"];

const money = (n) => `${Number(n || 0).toFixed(2)} DH`;
const fullName = (p) => (p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() : "");
const computeAge = (isoDate) => {
  if (!isoDate) return null;
  const b = new Date(isoDate);
  if (isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
};

function TricolorRule({ style }) {
  return (
    <div
      style={{
        height: 4,
        width: "100%",
        background:
          "linear-gradient(90deg, #2E7D46 0 33.3%, #F4EFE3 33.3% 66.6%, #B5232B 66.6% 100%)",
        ...style,
      }}
    />
  );
}

export default function App() {
  const [view, setView] = useState("boutique"); // boutique | compte | panier | mes-commandes | admin-login | admin
  const [authUser, setAuthUser] = useState(null); // supabase auth user
  const [profile, setProfile] = useState(null);
  const [afterLogin, setAfterLogin] = useState(null);

  const [products, setProducts] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [adminOrders, setAdminOrders] = useState([]);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  const loadProfile = useCallback(async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data || null);
    return data || null;
  }, []);

  // --- initial load + auth state ---
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setAuthUser(session.user);
        await loadProfile(session.user.id);
      }
      const { data: prods } = await supabase.from("products").select("*").order("created_at", { ascending: true });
      setProducts(prods || []);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setAuthUser(session.user);
        await loadProfile(session.user.id);
      } else {
        setAuthUser(null);
        setProfile(null);
        setMyOrders([]);
      }
    });
    return () => sub?.subscription?.unsubscribe();
  }, [loadProfile]);

  // "my orders" once profile is available
  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("customer_id", profile.id)
        .order("created_at", { ascending: false });
      setMyOrders(data || []);
    })();
  }, [profile]);

  const loadAdminOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, profiles(first_name,last_name,phone,email,address)")
      .order("created_at", { ascending: false });
    if (error) {
      showToast("Impossible de charger les commandes");
      return;
    }
    setAdminOrders(data || []);
  }, []);

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (view === "admin" && isAdmin) loadAdminOrders();
  }, [view, isAdmin, loadAdminOrders]);

  const registerAccount = async (f) => {
    const { data, error } = await supabase.auth.signUp({ email: f.email, password: f.password });
    if (error) throw error;
    if (data.session) {
      const { error: insertErr } = await supabase.from("profiles").insert({
        id: data.user.id,
        first_name: f.firstName,
        last_name: f.lastName,
        phone: f.phone,
        email: f.email,
        address: f.address || null,
        birthdate: f.birthdate,
        role: "customer",
      });
      if (insertErr) throw insertErr;
      await loadProfile(data.user.id);
      return { status: "ready" };
    }
    // email confirmation required — stash details to finish the profile on first real login
    try {
      sessionStorage.setItem("tiramimouss:pending-profile", JSON.stringify(f));
    } catch {}
    return { status: "confirm-email" };
  };

  const loginAccount = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    let p = await loadProfile(data.user.id);
    if (!p) {
      let pending = null;
      try {
        const raw = sessionStorage.getItem("tiramimouss:pending-profile");
        if (raw) pending = JSON.parse(raw);
      } catch {}
      if (pending && pending.email === email) {
        const { error: insertErr } = await supabase.from("profiles").insert({
          id: data.user.id,
          first_name: pending.firstName,
          last_name: pending.lastName,
          phone: pending.phone,
          email,
          address: pending.address || null,
          birthdate: pending.birthdate,
          role: "customer",
        });
        if (insertErr) throw insertErr;
        p = await loadProfile(data.user.id);
        try {
          sessionStorage.removeItem("tiramimouss:pending-profile");
        } catch {}
      }
    }
    return { status: p ? "ready" : "incomplete-profile" };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setView("boutique");
  };

  // --- cart ---
  const addToCart = (id) => {
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    showToast("Ajouté au panier");
  };
  const setQty = (id, qty) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };
  const cartItems = Object.entries(cart)
    .map(([id, qty]) => {
      const p = (products || []).find((p) => p.id === id);
      return p ? { ...p, qty } : null;
    })
    .filter(Boolean);
  const cartTotal = cartItems.reduce((s, i) => s + Number(i.price) * i.qty, 0);
  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  const placeOrder = async () => {
    if (cartItems.length === 0) return;
    if (!profile) {
      setAfterLogin("panier");
      setView("compte");
      return;
    }
    const { data, error } = await supabase
      .from("orders")
      .insert({
        customer_id: profile.id,
        items: cartItems.map(({ id, name, price, qty }) => ({ id, name, price, qty })),
        total: cartTotal,
        status: "Reçue",
      })
      .select()
      .single();
    if (error) {
      showToast("Échec de l'envoi de la commande");
      return;
    }
    setMyOrders((prev) => [data, ...prev]);
    setCart({});
    setView("mes-commandes");
    showToast("Commande envoyée");
  };

  const cancelOrder = async (order) => {
    const { data, error } = await supabase
      .from("orders")
      .update({ status: "Annulée" })
      .eq("id", order.id)
      .select()
      .single();
    if (error) {
      showToast("Impossible d'annuler cette commande");
      return;
    }
    setMyOrders((prev) => prev.map((o) => (o.id === order.id ? data : o)));
    showToast("Commande annulée");
  };

  const updateOrderStatus = async (id, status) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) {
      showToast("Échec de la mise à jour");
      return;
    }
    setAdminOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
  };

  const saveProduct = async (p) => {
    const body = {
      name: p.name,
      price: p.price,
      photo: p.photo,
      description: p.desc,
      promo: p.promo,
      promo_text: p.promo ? p.promoText : null,
    };
    if (p.id) {
      const { data, error } = await supabase.from("products").update(body).eq("id", p.id).select().single();
      if (error) {
        showToast("Échec de l'enregistrement du produit");
        return;
      }
      setProducts((prev) => prev.map((x) => (x.id === p.id ? data : x)));
    } else {
      const { data, error } = await supabase.from("products").insert(body).select().single();
      if (error) {
        showToast("Échec de l'enregistrement du produit");
        return;
      }
      setProducts((prev) => [...prev, data]);
    }
    showToast("Produit enregistré");
  };

  const deleteProduct = async (id) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      showToast("Échec de la suppression");
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast("Produit supprimé");
  };

  if (loading || !products) {
    return (
      <div style={styles().loadingWrap}>
        <style>{FONT_IMPORT}</style>
        <p style={{ fontFamily: "Inter, sans-serif", color: "#1C1A17" }}>Chargement…</p>
      </div>
    );
  }

  const s = styles();
  const activeBanners = products.filter((p) => p.promo && p.promo_text);
  const session = profile ? { user: authUser, profile } : null;

  return (
    <div style={s.page}>
      <style>{FONT_IMPORT}</style>

      <header style={s.header}>
        <div style={s.logoWrap}>
          <img src="/logo.png" alt="Tiramimouss — Les crèminels du goût" style={s.logoImg} />
        </div>
        <div style={s.headerInner}>
          <nav style={s.nav}>
            <button style={view === "boutique" ? s.navBtnActive : s.navBtn} onClick={() => setView("boutique")}>
              Boutique
            </button>
            <button
              style={view === "mes-commandes" ? s.navBtnActive : s.navBtn}
              onClick={() =>
                profile ? setView("mes-commandes") : (setAfterLogin("mes-commandes"), setView("compte"))
              }
            >
              Mes commandes
            </button>
            <button style={view === "panier" ? s.navBtnActive : s.navBtn} onClick={() => setView("panier")}>
              Panier{cartCount > 0 ? ` (${cartCount})` : ""}
            </button>
            <button
              style={view === "compte" ? s.navBtnActive : s.navBtn}
              onClick={() => {
                setAfterLogin(null);
                setView("compte");
              }}
            >
              Mon compte
            </button>
          </nav>
        </div>
      </header>
      <TricolorRule />

      <main style={s.main}>
        {view === "boutique" && <Boutique s={s} products={products} banners={activeBanners} addToCart={addToCart} />}

        {view === "compte" && (
          <AccountView
            s={s}
            profile={profile}
            onRegister={registerAccount}
            onLogin={loginAccount}
            onLogout={logout}
            afterLogin={afterLogin}
            goTo={setView}
          />
        )}

        {view === "panier" && (
          <Panier
            s={s}
            items={cartItems}
            setQty={setQty}
            total={cartTotal}
            profile={profile}
            placeOrder={placeOrder}
            goShop={() => setView("boutique")}
          />
        )}

        {view === "mes-commandes" && <MesCommandes s={s} orders={myOrders} onCancel={cancelOrder} />}

        {view === "admin-login" && (
          <AdminLogin s={s} profile={profile} isAdmin={isAdmin} onLogin={loginAccount} onEnter={() => setView("admin")} />
        )}

        {view === "admin" && isAdmin && (
          <Admin
            s={s}
            products={products}
            saveProduct={saveProduct}
            deleteProduct={deleteProduct}
            orders={adminOrders}
            updateOrderStatus={updateOrderStatus}
          />
        )}
      </main>

      <footer style={s.footer}>
        <button style={s.footerLink} onClick={() => setView(isAdmin ? "admin" : "admin-login")}>
          Accès professionnel
        </button>
      </footer>

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function Boutique({ s, products, banners, addToCart }) {
  return (
    <div>
      {banners.length > 0 && (
        <div style={s.bannerWrap}>
          {banners.map((b) => (
            <div key={b.id} style={s.banner}>
              {b.promo_text} — {b.name}
            </div>
          ))}
        </div>
      )}
      <div style={s.grid}>
        {products.map((p) => (
          <div key={p.id} style={s.card}>
            <div style={s.cardImgWrap}>
              <img src={p.photo} alt={p.name} style={s.cardImg} />
              {p.promo && <span style={s.promoBadge}>Promo</span>}
            </div>
            <div style={s.cardBody}>
              <h3 style={s.cardTitle}>{p.name}</h3>
              <p style={s.cardDesc}>{p.description}</p>
              <div style={s.cardFooter}>
                <span style={s.price}>{money(p.price)}</span>
                <button style={s.primaryBtnSm} onClick={() => addToCart(p.id)}>
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountView({ s, profile, onRegister, onLogin, onLogout, afterLogin, goTo }) {
  const [mode, setMode] = useState("login");

  if (profile) {
    return (
      <div style={s.loginWrap}>
        <div style={s.loginCard}>
          <h2 style={s.loginTitle}>Mon compte</h2>
          <div style={s.profileRow}>
            <span style={s.profileLabel}>Nom</span>
            <span style={s.profileValue}>{fullName(profile)}</span>
          </div>
          <div style={s.profileRow}>
            <span style={s.profileLabel}>Téléphone</span>
            <span style={s.profileValue}>{profile.phone}</span>
          </div>
          <div style={s.profileRow}>
            <span style={s.profileLabel}>Email</span>
            <span style={s.profileValue}>{profile.email}</span>
          </div>
          {profile.address && (
            <div style={s.profileRow}>
              <span style={s.profileLabel}>Adresse</span>
              <span style={s.profileValue}>{profile.address}</span>
            </div>
          )}
          <button style={{ ...s.secondaryBtn, width: "100%", marginTop: 14 }} onClick={onLogout}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return mode === "login" ? (
    <LoginForm s={s} onLogin={onLogin} onSwitch={() => setMode("signup")} afterLogin={afterLogin} goTo={goTo} />
  ) : (
    <SignUpForm s={s} onRegister={onRegister} onSwitch={() => setMode("login")} afterLogin={afterLogin} goTo={goTo} />
  );
}

function LoginForm({ s, onLogin, onSwitch, afterLogin, goTo }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setErr("Merci de renseigner votre email et votre mot de passe.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const r = await onLogin(email.trim(), password);
      if (r.status === "ready") goTo(afterLogin || "boutique");
      else setErr("Votre email n'est pas confirmé, ou votre profil est incomplet. Vérifiez vos emails puis réessayez.");
    } catch (e) {
      setErr(e.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : e.message);
    }
    setBusy(false);
  };

  return (
    <div style={s.loginWrap}>
      <div style={s.loginCard}>
        <h2 style={s.loginTitle}>Se connecter</h2>
        <input style={s.loginInput} type="email" placeholder="Adresse email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          style={s.loginInput}
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p style={s.loginError}>{err}</p>}
        <button style={s.loginBtn} onClick={submit} disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
        <button style={s.switchLink} onClick={onSwitch}>
          Pas encore de compte ? Créer un compte
        </button>
      </div>
    </div>
  );
}

function SignUpForm({ s, onRegister, onSwitch, afterLogin, goTo }) {
  const [f, setF] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    address: "",
    birthdate: "",
    password: "",
    password2: "",
  });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const maxBirthdate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().slice(0, 10);
  })();

  const submit = async () => {
    if (!f.firstName.trim() || !f.lastName.trim() || !f.phone.trim() || !f.email.trim() || !f.birthdate || !f.password) {
      setErr("Merci de remplir tous les champs obligatoires (adresse exceptée).");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(f.email)) {
      setErr("Adresse email invalide.");
      return;
    }
    const age = computeAge(f.birthdate);
    if (age === null) {
      setErr("Date de naissance invalide.");
      return;
    }
    if (age < 18) {
      setErr("L'inscription est réservée aux personnes majeures (18 ans et plus).");
      return;
    }
    if (f.password.length < 6) {
      setErr("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (f.password !== f.password2) {
      setErr("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const r = await onRegister(f);
      if (r.status === "ready") goTo(afterLogin || "boutique");
      else if (r.status === "confirm-email")
        setInfo("Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  if (info) {
    return (
      <div style={s.loginWrap}>
        <div style={s.loginCard}>
          <h2 style={s.loginTitle}>Presque prêt</h2>
          <p style={s.loginSubtitle}>{info}</p>
          <button style={s.loginBtn} onClick={onSwitch}>
            Aller à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.loginWrap}>
      <div style={s.loginCard}>
        <h2 style={s.loginTitle}>Créer mon compte</h2>
        <p style={s.loginSubtitle}>
          Ces informations servent à passer commande, suivre son statut, et à vous prévenir par email ou SMS si
          besoin. L'inscription est réservée aux personnes majeures.
        </p>
        <input style={s.loginInput} placeholder="Prénom" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        <input style={s.loginInput} placeholder="Nom" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        <input style={s.loginInput} placeholder="Numéro de téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input style={s.loginInput} type="email" placeholder="Adresse email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input style={s.loginInput} placeholder="Adresse (facultative)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <input
          style={s.loginInput}
          type="date"
          placeholder="Date de naissance"
          value={f.birthdate}
          max={maxBirthdate}
          onChange={(e) => setF({ ...f, birthdate: e.target.value })}
        />
        <input style={s.loginInput} type="password" placeholder="Mot de passe" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <input
          style={s.loginInput}
          type="password"
          placeholder="Confirmer le mot de passe"
          value={f.password2}
          onChange={(e) => setF({ ...f, password2: e.target.value })}
        />
        {err && <p style={s.loginError}>{err}</p>}
        <button style={s.loginBtn} onClick={submit} disabled={busy}>
          {busy ? "Création…" : "Créer mon compte"}
        </button>
        <button style={s.switchLink} onClick={onSwitch}>
          Déjà un compte ? Se connecter
        </button>
      </div>
    </div>
  );
}

function AdminLogin({ s, profile, isAdmin, onLogin, onEnter }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (profile && isAdmin) {
    return (
      <div style={s.loginWrap}>
        <div style={s.loginCard}>
          <h2 style={s.loginTitle}>Espace professionnel</h2>
          <p style={s.loginSubtitle}>Connecté en tant que {profile.email}.</p>
          <button style={s.loginBtn} onClick={onEnter}>
            Ouvrir l'administration
          </button>
        </div>
      </div>
    );
  }

  if (profile && !isAdmin) {
    return (
      <div style={s.loginWrap}>
        <div style={s.loginCard}>
          <h2 style={s.loginTitle}>Espace professionnel</h2>
          <p style={s.loginError}>Ce compte n'a pas les droits d'accès à l'administration.</p>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!email.trim() || !password) {
      setErr("Merci de renseigner l'email et le mot de passe professionnels.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const r = await onLogin(email.trim(), password);
      if (r.status !== "ready") setErr("Connexion impossible.");
    } catch (e) {
      setErr(e.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : e.message);
    }
    setBusy(false);
  };

  return (
    <div style={s.loginWrap}>
      <div style={s.loginCard}>
        <h2 style={s.loginTitle}>Espace professionnel</h2>
        <p style={s.loginSubtitle}>Réservé au gérant de Tiramimouss.</p>
        <input style={s.loginInput} type="email" placeholder="Email professionnel" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          style={s.loginInput}
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p style={s.loginError}>{err}</p>}
        <button style={s.loginBtn} onClick={submit} disabled={busy}>
          {busy ? "Connexion…" : "Entrer"}
        </button>
      </div>
    </div>
  );
}

function Panier({ s, items, setQty, total, profile, placeOrder, goShop }) {
  if (items.length === 0) {
    return (
      <div style={s.card}>
        <p style={s.muted}>Votre panier est vide.</p>
        <button style={s.primaryBtn} onClick={goShop}>
          Voir la boutique
        </button>
      </div>
    );
  }
  return (
    <div style={s.card}>
      <h2 style={s.h2}>Votre panier</h2>
      {items.map((i) => (
        <div key={i.id} style={s.cartRow}>
          <span style={{ flex: 1 }}>{i.name}</span>
          <input type="number" min="0" value={i.qty} onChange={(e) => setQty(i.id, parseInt(e.target.value) || 0)} style={s.qtyInput} />
          <span style={{ width: 90, textAlign: "right" }}>{money(i.price * i.qty)}</span>
        </div>
      ))}
      <div style={s.cartTotal}>Total TTC : {money(total)}</div>

      {profile && (
        <p style={s.muted}>
          Commande au nom de <strong>{fullName(profile)}</strong> — {profile.email} — {profile.phone}
        </p>
      )}

      <button style={s.primaryBtn} onClick={placeOrder}>
        {profile ? "Valider la commande" : "Se connecter pour commander"}
      </button>
    </div>
  );
}

function Receipt({ s, order }) {
  return (
    <div style={s.receipt}>
      <div style={s.receiptShopName}>TIRAMIMOUSS</div>
      <div style={s.receiptType}>Ticket de caisse</div>
      <div style={s.receiptMeta}>
        <span>N° {order.id.slice(0, 6).toUpperCase()}</span>
        <span>{new Date(order.created_at).toLocaleString("fr-FR")}</span>
      </div>
      <div style={s.receiptDivider} />
      {order.items.map((it) => (
        <div key={it.id} style={s.receiptLine}>
          <span>
            {it.qty} × {it.name}
          </span>
          <span>{money(it.price * it.qty)}</span>
        </div>
      ))}
      <div style={s.receiptDivider} />
      <div style={s.receiptTotal}>
        <span>Total TTC</span>
        <span>{money(order.total)}</span>
      </div>
      <div style={s.receiptFooter}>Merci de votre confiance</div>
    </div>
  );
}

function MesCommandes({ s, orders, onCancel }) {
  if (orders.length === 0) {
    return (
      <div style={s.card}>
        <p style={s.muted}>Aucune commande pour l'instant.</p>
      </div>
    );
  }
  return (
    <div>
      {orders.map((o) => (
        <div key={o.id} style={s.card}>
          <Receipt s={s} order={o} />
          {o.status === "Annulée" ? (
            <p style={{ color: "#B5232B", padding: "0 14px 14px", fontSize: 13, textAlign: "center" }}>Commande annulée</p>
          ) : (
            <>
              <StatusTrack status={o.status} s={s} />
              {o.status === "Reçue" && (
                <button
                  style={{ ...s.linkBtnDanger, padding: "0 14px 14px", display: "block", textAlign: "center", width: "100%" }}
                  onClick={() => onCancel(o)}
                >
                  Annuler la commande
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusTrack({ status, s }) {
  const idx = STATUSES.indexOf(status);
  return (
    <div style={s.track}>
      {STATUSES.map((st, i) => (
        <div key={st} style={s.trackStep}>
          <div style={i <= idx ? s.trackDotActive : s.trackDot} />
          <span style={i <= idx ? s.trackLabelActive : s.trackLabel}>{st}</span>
          {i < STATUSES.length - 1 && <div style={i < idx ? s.trackLineActive : s.trackLine} />}
        </div>
      ))}
    </div>
  );
}

function Admin({ s, products, saveProduct, deleteProduct, orders, updateOrderStatus }) {
  const [tab, setTab] = useState("produits");
  const [editing, setEditing] = useState(null);

  const blankProduct = () => ({ id: null, name: "", price: 0, photo: "", desc: "", promo: false, promoText: "" });

  const openEdit = (p) =>
    setEditing(
      p
        ? { id: p.id, name: p.name, price: p.price, photo: p.photo || "", desc: p.description || "", promo: p.promo, promoText: p.promo_text || "" }
        : blankProduct()
    );

  const submitProduct = async (p) => {
    await saveProduct(p);
    setEditing(null);
  };

  return (
    <div>
      <div style={s.adminTabs}>
        <button style={tab === "produits" ? s.navBtnActive : s.navBtn} onClick={() => setTab("produits")}>
          Produits & bannières
        </button>
        <button style={tab === "commandes" ? s.navBtnActive : s.navBtn} onClick={() => setTab("commandes")}>
          Commandes
        </button>
      </div>

      {tab === "produits" && (
        <div>
          <button style={s.primaryBtn} onClick={() => openEdit(null)}>
            + Nouveau produit
          </button>
          <div style={{ height: 16 }} />
          {editing && <ProductForm s={s} product={editing} onSave={submitProduct} onCancel={() => setEditing(null)} />}
          <div style={s.grid}>
            {products.map((p) => (
              <div key={p.id} style={s.card}>
                <div style={s.cardImgWrap}>
                  <img src={p.photo} alt={p.name} style={s.cardImg} />
                  {p.promo && <span style={s.promoBadge}>Promo</span>}
                </div>
                <div style={s.cardBody}>
                  <h3 style={s.cardTitle}>{p.name}</h3>
                  <span style={s.price}>{money(p.price)}</span>
                  {p.promo && <p style={s.promoText}>{p.promo_text}</p>}
                  <div style={s.adminCardActions}>
                    <button style={s.linkBtn} onClick={() => openEdit(p)}>
                      Modifier
                    </button>
                    <button style={s.linkBtnDanger} onClick={() => deleteProduct(p.id)}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "commandes" && (
        <div>
          {orders.length === 0 && <p style={s.muted}>Aucune commande pour l'instant.</p>}
          {orders.map((o) => {
            const c = o.profiles || {};
            const msg = `Commande #${o.id.slice(0, 6)} — statut : ${o.status}`;
            return (
              <div key={o.id} style={s.card}>
                <div style={s.orderHead}>
                  <span style={s.orderId}>
                    #{o.id.slice(0, 6)} — {c.first_name} {c.last_name} — {c.email} ({c.phone})
                    {c.address ? ` — ${c.address}` : ""}
                  </span>
                  <span style={s.price}>{money(o.total)}</span>
                </div>
                <ul style={s.orderItems}>
                  {o.items.map((it) => (
                    <li key={it.id}>
                      {it.qty} × {it.name} — {money(it.price * it.qty)}
                    </li>
                  ))}
                </ul>
                <div style={{ padding: "0 14px", fontSize: 13, color: "#1C1A1799" }}>Total TTC : {money(o.total)}</div>
                <div style={s.statusRow}>
                  <span style={s.muted}>Statut :</span>
                  <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} style={s.select}>
                    {[...STATUSES, "Annulée"].map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 14, padding: "0 14px 14px" }}>
                  {c.email && (
                    <a style={s.linkBtn} href={`mailto:${c.email}?subject=${encodeURIComponent("Tiramimouss — votre commande")}&body=${encodeURIComponent(msg)}`}>
                      Email
                    </a>
                  )}
                  {c.phone && (
                    <a style={s.linkBtn} href={`sms:${c.phone}?body=${encodeURIComponent(msg)}`}>
                      SMS
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductForm({ s, product, onSave, onCancel }) {
  const [p, setP] = useState(product);
  return (
    <div style={s.card}>
      <h3 style={s.h2}>{product.id ? "Modifier le produit" : "Nouveau produit"}</h3>
      <input style={s.input} placeholder="Nom du produit" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      <input style={s.input} type="number" placeholder="Prix (DH)" value={p.price} onChange={(e) => setP({ ...p, price: parseFloat(e.target.value) || 0 })} />
      <input style={s.input} placeholder="URL de la photo" value={p.photo} onChange={(e) => setP({ ...p, photo: e.target.value })} />
      <textarea style={{ ...s.input, minHeight: 60 }} placeholder="Description" value={p.desc} onChange={(e) => setP({ ...p, desc: e.target.value })} />
      <label style={s.checkboxRow}>
        <input type="checkbox" checked={p.promo} onChange={(e) => setP({ ...p, promo: e.target.checked })} />
        Afficher une bannière promo
      </label>
      {p.promo && (
        <input style={s.input} placeholder="Texte de la promo (ex : -10% ce week-end)" value={p.promoText} onChange={(e) => setP({ ...p, promoText: e.target.value })} />
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button style={s.primaryBtn} onClick={() => onSave(p)}>
          Enregistrer
        </button>
        <button style={s.secondaryBtn} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function styles() {
  const ink = "#1C1A17";
  const cream = "#F4EFE3";
  const blue = "#16376B";
  const red = "#B5232B";
  const serif = "'Fraunces', serif";
  const sans = "'Inter', sans-serif";

  return {
    page: { fontFamily: sans, background: cream, minHeight: "100vh", color: ink },
    loadingWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: cream },
    header: { padding: "10px 20px 6px", background: cream },
    logoWrap: { display: "flex", justifyContent: "center", marginBottom: 2 },
    logoImg: { width: 190, height: 190, objectFit: "contain" },
    headerInner: { maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: 12 },
    nav: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" },
    navBtn: { fontFamily: sans, fontSize: 13, padding: "8px 12px", borderRadius: 20, border: `1px solid ${ink}22`, background: "transparent", color: ink, cursor: "pointer" },
    navBtnActive: { fontFamily: sans, fontSize: 13, padding: "8px 12px", borderRadius: 20, border: `1px solid ${blue}`, background: blue, color: cream, cursor: "pointer" },
    main: { maxWidth: 960, margin: "0 auto", padding: "22px 20px 20px" },
    bannerWrap: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 },
    banner: { background: red, color: cream, padding: "10px 16px", borderRadius: 8, fontFamily: serif, fontSize: 15 },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 },
    card: { background: "#FFFFFF", border: `1px solid ${ink}14`, borderRadius: 12, overflow: "hidden", padding: 0, marginBottom: 18 },
    cardImgWrap: { position: "relative", width: "100%", aspectRatio: "4/3", background: `${ink}08` },
    cardImg: { width: "100%", height: "100%", objectFit: "cover" },
    promoBadge: { position: "absolute", top: 10, left: 10, background: red, color: cream, fontSize: 11, padding: "3px 9px", borderRadius: 12, fontFamily: sans, fontWeight: 600 },
    cardBody: { padding: 14 },
    cardTitle: { fontFamily: serif, fontSize: 19, margin: "0 0 4px" },
    cardDesc: { fontSize: 13, color: `${ink}99`, margin: "0 0 10px", lineHeight: 1.4 },
    cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center" },
    price: { fontFamily: serif, fontSize: 16, fontWeight: 600, color: blue },
    promoText: { fontSize: 12, color: red, margin: "2px 0 8px" },
    primaryBtn: { display: "block", marginTop: 12, background: blue, color: cream, border: "none", borderRadius: 8, padding: "10px 16px", fontFamily: sans, fontSize: 14, cursor: "pointer" },
    primaryBtnSm: { background: blue, color: cream, border: "none", borderRadius: 8, padding: "7px 12px", fontFamily: sans, fontSize: 13, cursor: "pointer" },
    secondaryBtn: { marginTop: 12, background: "transparent", color: ink, border: `1px solid ${ink}33`, borderRadius: 8, padding: "10px 16px", fontFamily: sans, fontSize: 14, cursor: "pointer" },
    linkBtn: { background: "none", border: "none", color: blue, cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "none" },
    linkBtnDanger: { background: "none", border: "none", color: red, cursor: "pointer", fontSize: 13, padding: 0 },
    input: { display: "block", width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 10, border: `1px solid ${ink}22`, borderRadius: 8, fontFamily: sans, fontSize: 14, background: "#FFFFFF" },
    loginWrap: { display: "flex", justifyContent: "center", paddingTop: 20 },
    loginCard: { width: "100%", maxWidth: 380, background: "#FFFFFF", border: `1px solid ${ink}14`, borderRadius: 20, padding: "28px 26px", textAlign: "center", boxShadow: `0 6px 24px ${ink}0F` },
    loginTitle: { fontFamily: serif, fontSize: 24, margin: "0 0 8px", color: ink },
    loginSubtitle: { fontSize: 13, color: `${ink}99`, lineHeight: 1.5, margin: "0 0 20px" },
    loginInput: { display: "block", width: "100%", boxSizing: "border-box", padding: "13px 16px", marginBottom: 12, border: `1.5px solid ${ink}26`, borderRadius: 14, fontFamily: sans, fontSize: 15, fontWeight: 600, color: ink, textAlign: "center", background: cream, outline: "none" },
    loginError: { color: red, fontSize: 13, margin: "-2px 0 12px" },
    loginBtn: { width: "100%", background: blue, color: cream, border: "none", borderRadius: 14, padding: "13px 16px", fontFamily: sans, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 },
    switchLink: { display: "block", width: "100%", background: "none", border: "none", color: blue, fontSize: 13, fontFamily: sans, cursor: "pointer", marginTop: 14 },
    checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, margin: "4px 0 10px" },
    h2: { fontFamily: serif, fontSize: 22, margin: "0 0 10px" },
    muted: { color: `${ink}88`, fontSize: 14 },
    cartRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${ink}10` },
    qtyInput: { width: 54, padding: "6px 8px", border: `1px solid ${ink}22`, borderRadius: 6 },
    cartTotal: { fontFamily: serif, fontSize: 18, textAlign: "right", padding: "14px", fontWeight: 600 },
    orderHead: { display: "flex", justifyContent: "space-between", padding: "14px 14px 0", alignItems: "center" },
    orderId: { fontSize: 13, color: `${ink}99` },
    orderItems: { padding: "8px 14px", margin: 0, fontSize: 14 },
    track: { display: "flex", padding: "6px 14px 16px", alignItems: "center" },
    trackStep: { display: "flex", alignItems: "center", flex: 1, flexDirection: "column", position: "relative" },
    trackDot: { width: 12, height: 12, borderRadius: "50%", background: `${ink}22` },
    trackDotActive: { width: 12, height: 12, borderRadius: "50%", background: blue },
    trackLabel: { fontSize: 10, color: `${ink}66`, marginTop: 4, textAlign: "center" },
    trackLabelActive: { fontSize: 10, color: blue, marginTop: 4, textAlign: "center", fontWeight: 600 },
    trackLine: { position: "absolute", top: 6, left: "60%", width: "80%", height: 2, background: `${ink}18` },
    trackLineActive: { position: "absolute", top: 6, left: "60%", width: "80%", height: 2, background: blue },
    adminTabs: { display: "flex", gap: 8, marginBottom: 18 },
    adminCardActions: { display: "flex", gap: 14, marginTop: 10 },
    statusRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px 14px" },
    select: { padding: "7px 10px", borderRadius: 6, border: `1px solid ${ink}22`, fontFamily: sans },
    footer: { display: "flex", justifyContent: "center", padding: "30px 20px 40px" },
    footerLink: { background: "none", border: "none", color: `${ink}55`, fontSize: 11, fontFamily: sans, cursor: "pointer", padding: 4 },
    profileRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${ink}12`, textAlign: "left" },
    profileLabel: { fontSize: 12, color: `${ink}77`, fontFamily: sans },
    profileValue: { fontSize: 14, color: ink, fontFamily: sans, fontWeight: 600, textAlign: "right" },
    receipt: { fontFamily: "'Courier New', monospace", background: "#FFFFFF", padding: "18px 20px", borderBottom: `1px dashed ${ink}33` },
    receiptShopName: { textAlign: "center", fontWeight: 700, fontSize: 16, letterSpacing: 1 },
    receiptType: { textAlign: "center", fontSize: 11, color: `${ink}77`, marginBottom: 8 },
    receiptMeta: { display: "flex", justifyContent: "space-between", fontSize: 11, color: `${ink}88`, marginBottom: 6 },
    receiptDivider: { borderTop: `1px dashed ${ink}33`, margin: "8px 0" },
    receiptLine: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0" },
    receiptTotal: { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, padding: "4px 0" },
    receiptFooter: { textAlign: "center", fontSize: 11, color: `${ink}77`, marginTop: 10 },
    toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1C1A17", color: "#F4EFE3", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontFamily: sans },
  };
}

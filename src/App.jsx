import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus, Trash2, Pencil, X, Check, Landmark, Wallet, PiggyBank,
  ArrowDownRight, ArrowUpRight, ArrowUpDown, ArrowLeftRight, TrendingUp,
  Search, Cloud, CloudOff, Loader2, RefreshCw,
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

// ---- Konfigurasi sinkronisasi Google Sheets (Apps Script Web App) ----
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || "";
const APP_TOKEN = import.meta.env.VITE_APP_TOKEN || "";
const SYNC_ENABLED = Boolean(APPS_SCRIPT_URL);
const SAVE_DEBOUNCE_MS = 900;

const SORT_OPTIONS = [
  { id: "tanggal-desc", label: "Tanggal terbaru" },
  { id: "tanggal-asc", label: "Tanggal terlama" },
  { id: "jumlah-desc", label: "Jumlah terbesar" },
  { id: "jumlah-asc", label: "Jumlah terkecil" },
  { id: "nama-asc", label: "Nama A-Z" },
];

const ACCOUNTS = [
  { id: "Rekening Pribadi", label: "Rekening Pribadi", icon: Landmark },
  { id: "Uang Tunai", label: "Uang Tunai", icon: Wallet },
  { id: "Rekening Tabungan", label: "Rekening Tabungan", icon: PiggyBank },
];

const CATEGORY_SUGGESTIONS = ["Lainnya", "Insentif", "Freelance", "Gaji", "Kebutuhan Pokok", "Transportasi", "Hiburan"];

const initialTransactions = [
  { id: 1, tanggal: "2026-08-20", nama: "Saldo Awal", kategori: "Lainnya", tipe: "in", jumlah: 150655, akun: "Rekening Pribadi" },
  { id: 2, tanggal: "2026-08-20", nama: "Saldo Awal", kategori: "Lainnya", tipe: "in", jumlah: 34000, akun: "Uang Tunai" },
  { id: 3, tanggal: "2026-08-20", nama: "Tol", kategori: "Insentif", tipe: "in", jumlah: 50000, akun: "Uang Tunai" },
  { id: 4, tanggal: "2026-08-20", nama: "Camilan", kategori: "Kebutuhan Pokok", tipe: "out", jumlah: 20000, akun: "Uang Tunai" },
  { id: 5, tanggal: "2026-08-21", nama: "KOL", kategori: "Freelance", tipe: "in", jumlah: 60000, akun: "Rekening Pribadi" },
];

const COLORS = {
  bg: "#FFFFFF",
  surface: "#F7F8F9",
  border: "#E4E6E7",
  text: "#001E00",
  textMuted: "#6E7B7C",
  green: "#108A00",
  greenDark: "#0C6E00",
  greenSoft: "#E7F5E4",
  red: "#B42318",
  redSoft: "#FBEAE9",
  blue: "#1D4ED8",
  blueSoft: "#EAF1FE",
};

const rupiah = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n || 0);

const formatRibuan = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digits));
};

const formatTanggal = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${BULAN_ID[Number(m) - 1]} ${y}`;
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  fontSize: 13,
  background: "#fff",
  color: COLORS.text,
};

// ---- Helper fetch ke Apps Script ----
async function fetchFromSheet() {
  const url = `${APPS_SCRIPT_URL}?token=${encodeURIComponent(APP_TOKEN)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal memuat data");
  return data.transactions;
}

// Dikirim sebagai text/plain supaya browser tidak melakukan CORS preflight
// (Apps Script Web App tidak menangani OPTIONS secara default).
async function pushToSheet(transactions) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "sync", token: APP_TOKEN, transactions }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menyimpan data");
  return data;
}

export default function BukuKas() {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [activeAccount, setActiveAccount] = useState("Semua");
  const [sortBy, setSortBy] = useState("tanggal-desc");
  const [activeMonth, setActiveMonth] = useState("Semua");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [form, setForm] = useState({
    tanggal: new Date().toISOString().slice(0, 10),
    nama: "",
    kategori: "",
    tipe: "out",
    jumlah: "",
    akun: ACCOUNTS[0].id,
    akunTujuan: ACCOUNTS[1].id,
  });

  // ---- Status sinkronisasi Google Sheets ----
  const [isLoaded, setIsLoaded] = useState(!SYNC_ENABLED);
  const [syncStatus, setSyncStatus] = useState(SYNC_ENABLED ? "loading" : "local");
  const saveTimer = useRef(null);
  const skipNextSave = useRef(SYNC_ENABLED);

  // Muat data dari Google Sheets saat pertama kali dibuka
  useEffect(() => {
    if (!SYNC_ENABLED) return;
    fetchFromSheet()
      .then((remote) => {
        if (Array.isArray(remote) && remote.length > 0) setTransactions(remote);
        setSyncStatus("saved");
      })
      .catch(() => setSyncStatus("error"))
      .finally(() => setIsLoaded(true));
  }, []);

  // Simpan (debounced) ke Google Sheets setiap kali data berubah
  useEffect(() => {
    if (!SYNC_ENABLED || !isLoaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setSyncStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      pushToSheet(transactions)
        .then(() => setSyncStatus("saved"))
        .catch(() => setSyncStatus("error"));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, isLoaded]);

  const reloadFromSheet = () => {
    if (!SYNC_ENABLED) return;
    setSyncStatus("loading");
    fetchFromSheet()
      .then((remote) => {
        skipNextSave.current = true;
        setTransactions(remote);
        setSyncStatus("saved");
      })
      .catch(() => setSyncStatus("error"));
  };

  const balances = useMemo(() => {
    const map = {};
    ACCOUNTS.forEach((a) => (map[a.id] = 0));
    transactions.forEach((t) => {
      map[t.akun] = (map[t.akun] || 0) + (t.tipe === "in" ? t.jumlah : -t.jumlah);
    });
    return map;
  }, [transactions]);

  const totalSaldo = useMemo(() => Object.values(balances).reduce((a, b) => a + b, 0), [balances]);

  const totals = useMemo(() => {
    let masuk = 0, keluar = 0;
    transactions.forEach((t) => {
      if (t.isTransfer) return;
      if (t.tipe === "in") masuk += t.jumlah;
      else keluar += t.jumlah;
    });
    return { masuk, keluar };
  }, [transactions]);

  const groupBy = (list, key) => {
    const map = new Map();
    list.forEach((t) => {
      const k = t[key];
      if (!map.has(k)) map.set(k, { label: k, masuk: 0, keluar: 0 });
      const g = map.get(k);
      if (t.tipe === "in") g.masuk += t.jumlah;
      else g.keluar += t.jumlah;
    });
    return [...map.values()].sort((a, b) => (b.masuk + b.keluar) - (a.masuk + a.keluar));
  };

  const monthOptions = useMemo(() => {
    const keys = new Set(transactions.map((t) => t.tanggal.slice(0, 7)));
    return [...keys].sort().reverse();
  }, [transactions]);

  const visibleTx = useMemo(() => {
    let list = activeAccount === "Semua" ? transactions : transactions.filter((t) => t.akun === activeAccount);
    if (activeMonth !== "Semua") {
      list = list.filter((t) => t.tanggal.slice(0, 7) === activeMonth);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.nama.toLowerCase().includes(q) ||
          t.kategori.toLowerCase().includes(q) ||
          t.akun.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      switch (sortBy) {
        case "tanggal-asc":
          return a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : a.id - b.id;
        case "jumlah-desc":
          return b.jumlah - a.jumlah;
        case "jumlah-asc":
          return a.jumlah - b.jumlah;
        case "nama-asc":
          return a.nama.localeCompare(b.nama, "id");
        case "tanggal-desc":
        default:
          return a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : b.id - a.id;
      }
    });
    return sorted;
  }, [transactions, activeAccount, activeMonth, sortBy, searchQuery]);

  const kategoriSummary = useMemo(() => groupBy(visibleTx, "kategori"), [visibleTx]);
  const namaSummary = useMemo(() => groupBy(visibleTx, "nama"), [visibleTx]);

  const trendData = useMemo(() => {
    let list = activeAccount === "Semua" ? transactions : transactions.filter((t) => t.akun === activeAccount);
    if (activeMonth !== "Semua") {
      list = list.filter((t) => t.tanggal.slice(0, 7) === activeMonth);
    }
    list = list.filter((t) => !t.isTransfer);

    const map = new Map();
    list.forEach((t) => {
      if (!map.has(t.tanggal)) map.set(t.tanggal, { tanggal: t.tanggal, masuk: 0, keluar: 0 });
      const g = map.get(t.tanggal);
      if (t.tipe === "in") g.masuk += t.jumlah;
      else g.keluar += t.jumlah;
    });

    let saldoBerjalan = 0;
    return [...map.values()]
      .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0))
      .map((g) => {
        saldoBerjalan += g.masuk - g.keluar;
        return { ...g, label: formatTanggal(g.tanggal).slice(0, 5), saldo: saldoBerjalan };
      });
  }, [transactions, activeAccount, activeMonth]);

  const saveTransaction = () => {
    if (form.tipe === "transfer") {
      if (!form.jumlah || Number(form.jumlah) <= 0) {
        setError("Jumlah harus lebih dari 0.");
        return;
      }
      if (form.akun === form.akunTujuan) {
        setError("Akun asal dan akun tujuan harus berbeda.");
        return;
      }
      setError("");

      const jumlah = Number(form.jumlah);
      const asalLabel = ACCOUNTS.find((a) => a.id === form.akun)?.label || form.akun;
      const tujuanLabel = ACCOUNTS.find((a) => a.id === form.akunTujuan)?.label || form.akunTujuan;
      const transferId = `tr-${Date.now()}`;
      const namaKustom = form.nama.trim();

      setTransactions((prev) => [
        ...prev,
        {
          id: Date.now(),
          tanggal: form.tanggal,
          nama: namaKustom || `Transfer ke ${tujuanLabel}`,
          kategori: "Transfer",
          tipe: "out",
          jumlah,
          akun: form.akun,
          isTransfer: true,
          transferId,
        },
        {
          id: Date.now() + 1,
          tanggal: form.tanggal,
          nama: namaKustom || `Transfer dari ${asalLabel}`,
          kategori: "Transfer",
          tipe: "in",
          jumlah,
          akun: form.akunTujuan,
          isTransfer: true,
          transferId,
        },
      ]);

      setForm((f) => ({ ...f, nama: "", jumlah: "" }));
      return;
    }

    if (!form.nama.trim()) {
      setError("Nama transaksi belum diisi.");
      return;
    }
    if (!form.jumlah || Number(form.jumlah) <= 0) {
      setError("Jumlah harus lebih dari 0.");
      return;
    }
    setError("");

    if (editingId !== null) {
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === editingId
            ? {
                ...t,
                tanggal: form.tanggal,
                nama: form.nama.trim(),
                kategori: form.kategori.trim() || "Lainnya",
                tipe: form.tipe,
                jumlah: Number(form.jumlah),
                akun: form.akun,
              }
            : t
        )
      );
      setEditingId(null);
    } else {
      setTransactions((prev) => [
        ...prev,
        {
          id: Date.now(),
          tanggal: form.tanggal,
          nama: form.nama.trim(),
          kategori: form.kategori.trim() || "Lainnya",
          tipe: form.tipe,
          jumlah: Number(form.jumlah),
          akun: form.akun,
        },
      ]);
    }

    setForm((f) => ({ ...f, nama: "", kategori: "", jumlah: "" }));
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setConfirmDeleteId(null);
    setForm({
      tanggal: t.tanggal,
      nama: t.nama,
      kategori: t.kategori,
      tipe: t.tipe,
      jumlah: String(t.jumlah),
      akun: t.akun,
      akunTujuan: form.akunTujuan,
    });
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm((f) => ({ ...f, nama: "", kategori: "", jumlah: "" }));
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveTransaction();
  };

  const requestDelete = (id) => setConfirmDeleteId(id);

  const cancelDelete = () => setConfirmDeleteId(null);

  const removeTx = (id) => {
    const target = transactions.find((t) => t.id === id);
    setTransactions((prev) =>
      prev.filter((t) => (target?.transferId ? t.transferId !== target.transferId : t.id !== id))
    );
    setConfirmDeleteId(null);
    if (editingId === id) cancelEdit();
  };

  return (
    <div
      style={{
        background: COLORS.surface,
        fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
        minHeight: "100vh",
        color: COLORS.text,
        padding: "clamp(16px, 4vw, 40px)",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input, select { font-family: 'Inter', sans-serif; }
        input:focus, select:focus { outline: none; border-color: ${COLORS.green} !important; box-shadow: 0 0 0 3px ${COLORS.greenSoft}; }
        .tx-row:hover { background: ${COLORS.surface}; }
        .pill:hover { border-color: ${COLORS.green}; }
        .del-btn { opacity: 0; transition: opacity 0.15s; }
        .tx-row:hover .del-btn { opacity: 1; }
        @media (hover: none) { .del-btn { opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: COLORS.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>P</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>Pundi.</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Total Saldo
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COLORS.green, letterSpacing: "-0.02em" }}>
              {rupiah(totalSaldo)}
            </p>
          </div>
        </div>

        <SyncBadge status={syncStatus} onReload={reloadFromSheet} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 20, marginTop: 20 }}>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>Pemasukan</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, color: COLORS.green }}>{rupiah(totals.masuk)}</p>
          </div>
          <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>Pengeluaran</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, color: COLORS.red }}>{rupiah(totals.keluar)}</p>
          </div>
          {ACCOUNTS.map((a) => (
            <div key={a.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>{a.label}</p>
              <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700 }}>{rupiah(balances[a.id])}</p>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: COLORS.textMuted, pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Cari nama, kategori, atau akun..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...inputStyle, width: "100%", paddingLeft: 36, paddingRight: searchQuery ? 36 : 12 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Bersihkan pencarian"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted,
                padding: 4, display: "flex", alignItems: "center",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {["Semua", ...ACCOUNTS.map((a) => a.id)].map((id) => {
            const isActive = activeAccount === id;
            return (
              <button
                key={id}
                className="pill"
                onClick={() => setActiveAccount(id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: `1px solid ${isActive ? COLORS.green : COLORS.border}`,
                  background: isActive ? COLORS.greenSoft : COLORS.bg,
                  color: isActive ? COLORS.greenDark : COLORS.textMuted,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {id === "Semua" ? "Semua" : id}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <select
            value={activeMonth}
            onChange={(e) => setActiveMonth(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 999,
              border: `1px solid ${activeMonth !== "Semua" ? COLORS.green : COLORS.border}`,
              background: activeMonth !== "Semua" ? COLORS.greenSoft : COLORS.bg,
              color: activeMonth !== "Semua" ? COLORS.greenDark : COLORS.textMuted,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value="Semua">Semua Bulan</option>
            {monthOptions.map((key) => (
              <option key={key} value={key}>{monthLabel(key)}</option>
            ))}
          </select>

          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <ArrowUpDown size={13} style={{ position: "absolute", left: 10, color: COLORS.textMuted, pointerEvents: "none" }} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                padding: "7px 12px 7px 30px",
                borderRadius: 999,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.bg,
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                appearance: "none",
              }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: "18px 18px 8px", marginBottom: 20 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={15} color={COLORS.green} /> Tren Pemasukan & Pengeluaran
          </p>
          {trendData.length === 0 ? (
            <p style={{ textAlign: "center", color: COLORS.textMuted, padding: "36px 0", fontSize: 13, margin: 0 }}>
              Belum ada data untuk ditampilkan.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.textMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: COLORS.textMuted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}jt` : v >= 1000 ? `${Math.round(v / 1000)}rb` : v)}
                />
                <Tooltip
                  formatter={(value, name) => [rupiah(value), name]}
                  labelFormatter={(label) => `Tanggal ${label}`}
                  contentStyle={{ borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => (value === "masuk" ? "Pemasukan" : value === "keluar" ? "Pengeluaran" : "Saldo")} />
                <Line type="monotone" dataKey="masuk" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="keluar" stroke={COLORS.red} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="saldo" stroke={COLORS.blue} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: COLORS.bg,
            border: `1px solid ${editingId !== null ? COLORS.green : COLORS.border}`,
            borderRadius: 14,
            padding: 18,
            marginBottom: 20,
          }}
        >
          {editingId !== null && (
            <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: COLORS.greenDark, display: "flex", alignItems: "center", gap: 6 }}>
              <Pencil size={12} /> Mengedit transaksi
            </p>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, tipe: "out" }))}
              style={{
                flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${form.tipe === "out" ? COLORS.red : COLORS.border}`,
                background: form.tipe === "out" ? COLORS.redSoft : COLORS.bg,
                color: form.tipe === "out" ? COLORS.red : COLORS.textMuted,
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <ArrowDownRight size={14} /> Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, tipe: "in" }))}
              style={{
                flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${form.tipe === "in" ? COLORS.green : COLORS.border}`,
                background: form.tipe === "in" ? COLORS.greenSoft : COLORS.bg,
                color: form.tipe === "in" ? COLORS.greenDark : COLORS.textMuted,
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <ArrowUpRight size={14} /> Pemasukan
            </button>
            <button
              type="button"
              onClick={() => { setEditingId(null); setForm((f) => ({ ...f, tipe: "transfer" })); }}
              style={{
                flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${form.tipe === "transfer" ? COLORS.blue : COLORS.border}`,
                background: form.tipe === "transfer" ? COLORS.blueSoft : COLORS.bg,
                color: form.tipe === "transfer" ? COLORS.blue : COLORS.textMuted,
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <ArrowLeftRight size={14} /> Transfer
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input type="date" value={form.tanggal} onChange={(e) => setForm((f) => ({ ...f, tanggal: e.target.value }))} style={inputStyle} />
            <select value={form.akun} onChange={(e) => setForm((f) => ({ ...f, akun: e.target.value }))} style={inputStyle}>
              {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{form.tipe === "transfer" ? `Dari: ${a.label}` : a.label}</option>)}
            </select>
            <input
              type="text" placeholder={form.tipe === "transfer" ? "Nama transfer (opsional)" : "Nama transaksi"} value={form.nama}
              onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
              style={inputStyle}
            />
            {form.tipe === "transfer" ? (
              <select
                value={form.akunTujuan}
                onChange={(e) => setForm((f) => ({ ...f, akunTujuan: e.target.value }))}
                style={inputStyle}
              >
                {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{`Ke: ${a.label}`}</option>)}
              </select>
            ) : (
              <input
                type="text" list="kategori-list" placeholder="Kategori" value={form.kategori}
                onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}
                style={inputStyle}
              />
            )}
            <datalist id="kategori-list">
              {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
            <input
              type="text" inputMode="numeric" placeholder="Jumlah (Rp)" value={formatRibuan(form.jumlah)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setForm((f) => ({ ...f, jumlah: digits }));
              }}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={saveTransaction}
              style={{
                background: COLORS.green, color: "#fff", border: "none", borderRadius: 8,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {editingId !== null ? <Pencil size={15} /> : form.tipe === "transfer" ? <ArrowLeftRight size={15} /> : <Plus size={16} />}
              {editingId !== null ? "Simpan Perubahan" : form.tipe === "transfer" ? "Transfer" : "Catat"}
            </button>
          </div>
          {editingId !== null && (
            <button
              type="button"
              onClick={cancelEdit}
              style={{
                marginTop: 10, background: "none", border: "none", cursor: "pointer",
                color: COLORS.textMuted, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 4, padding: 0,
              }}
            >
              <X size={13} /> Batal edit
            </button>
          )}
          {error && <p style={{ margin: "10px 0 0", color: COLORS.red, fontSize: 12, fontWeight: 600 }}>{error}</p>}
        </form>

        <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 14, overflow: "hidden" }}>
          {visibleTx.length === 0 ? (
            <p style={{ textAlign: "center", color: COLORS.textMuted, padding: "36px 0", fontSize: 14, margin: 0 }}>
              Belum ada catatan untuk filter ini.
            </p>
          ) : (
            visibleTx.map((t, i) => (
              <div
                key={t.id}
                className="tx-row"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 18px",
                  background: editingId === t.id ? COLORS.greenSoft : "transparent",
                  borderBottom: i === visibleTx.length - 1 ? "none" : `1px solid ${COLORS.border}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                      background: t.isTransfer ? COLORS.blueSoft : t.tipe === "in" ? COLORS.greenSoft : COLORS.redSoft,
                      color: t.isTransfer ? COLORS.blue : t.tipe === "in" ? COLORS.greenDark : COLORS.red,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {t.isTransfer ? <ArrowLeftRight size={16} /> : t.tipe === "in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.nama}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted }}>
                      {formatTanggal(t.tanggal)} · {t.kategori} · {t.akun}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: t.isTransfer ? COLORS.blue : t.tipe === "in" ? COLORS.green : COLORS.red }}>
                    {t.tipe === "in" ? "+" : "-"}{rupiah(t.jumlah)}
                  </span>
                  {!t.isTransfer && (
                    <button
                      className="del-btn"
                      onClick={() => startEdit(t)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4 }}
                      aria-label="Edit transaksi"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {confirmDeleteId === t.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 600 }}>
                        {t.isTransfer ? "Hapus keduanya?" : "Yakin?"}
                      </span>
                      <button
                        onClick={() => removeTx(t.id)}
                        style={{
                          background: COLORS.redSoft, border: `1px solid ${COLORS.red}`, borderRadius: 6,
                          cursor: "pointer", color: COLORS.red, padding: 4, display: "flex", alignItems: "center",
                        }}
                        aria-label="Konfirmasi hapus"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={cancelDelete}
                        style={{
                          background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 6,
                          cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex", alignItems: "center",
                        }}
                        aria-label="Batal hapus"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="del-btn"
                      onClick={() => requestDelete(t.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4 }}
                      aria-label="Hapus transaksi"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Ringkasan per kategori & nama transaksi */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 14, marginTop: 20 }}>
          <SummaryCard title="Per Kategori" rows={kategoriSummary} />
          <SummaryCard title="Per Nama Transaksi" rows={namaSummary} />
        </div>
      </div>
    </div>
  );
}

function SyncBadge({ status, onReload }) {
  if (status === "local") {
    return (
      <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
        <CloudOff size={13} /> Mode lokal — sinkron Google Sheets belum dikonfigurasi (lihat README.md)
      </p>
    );
  }
  const map = {
    loading: { icon: <Loader2 size={13} className="spin" />, text: "Memuat dari Sheets...", color: COLORS.textMuted },
    saving: { icon: <Loader2 size={13} className="spin" />, text: "Menyimpan ke Sheets...", color: COLORS.textMuted },
    saved: { icon: <Cloud size={13} />, text: "Tersimpan di Google Sheets", color: COLORS.green },
    error: { icon: <CloudOff size={13} />, text: "Gagal sinkron — cek koneksi/token", color: COLORS.red },
  };
  const s = map[status] || map.saved;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 11, color: s.color, display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
        {s.icon} {s.text}
      </p>
      <button
        type="button"
        onClick={onReload}
        title="Muat ulang dari Google Sheets"
        style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 2, display: "flex" }}
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );
}

function SummaryCard({ title, rows }) {
  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${COLORS.border}` }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{title}</p>
      </div>
      {rows.length === 0 ? (
        <p style={{ textAlign: "center", color: COLORS.textMuted, padding: "24px 0", fontSize: 13, margin: 0 }}>
          Tidak ada data.
        </p>
      ) : (
        rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 18px",
              borderBottom: i === rows.length - 1 ? "none" : `1px solid ${COLORS.border}`,
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.label}
            </span>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, fontSize: 12 }}>
              {r.masuk > 0 && <span style={{ color: COLORS.green, fontWeight: 700 }}>+{rupiah(r.masuk)}</span>}
              {r.keluar > 0 && <span style={{ color: COLORS.red, fontWeight: 700 }}>-{rupiah(r.keluar)}</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}


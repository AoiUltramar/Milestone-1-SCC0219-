/* ==========================================================================
   seed-data.js — what a brand-new database contains
   --------------------------------------------------------------------------
   Ten products (VMs, VPN plans and add-ons) and one physical server per data
   center. VM plans have no stock of their own: their availability is derived
   from the physical servers (see capacity.js), so `stock` is forced to 0.
   ========================================================================== */

const { CATEGORIES } = require("../shared/config");

const RAW_PRODUCTS = [
    { id: "nano-vm", category: "vms", name: "Nano VM", icon: "🖥️", price: 19.9, unit: "/mo", stock: 120, sold: 341,
      description: "Small and cheap: a personal website, a Discord bot, a VPN endpoint or a first server to learn on.",
      specs: [["CPU", "1 vCPU"], ["Memory", "1 GB RAM"], ["Storage", "25 GB SSD"], ["Transfer", "500 GB per month"], ["Network", "1 public IPv4 + IPv6"]] },
    { id: "standard-vm", category: "vms", name: "Standard VM", icon: "🖥️", price: 49.9, unit: "/mo", stock: 42, sold: 512, trial: true,
      description: "A dependable everyday server: host a website, run a game server, a database or your side project's API.",
      specs: [["CPU", "2 vCPU"], ["Memory", "4 GB RAM"], ["Storage", "80 GB SSD"], ["Transfer", "1 TB per month"], ["Network", "1 public IPv4 + IPv6"]] },
    { id: "performance-vm", category: "vms", name: "Performance VM", icon: "🚀", price: 249.9, unit: "/mo", stock: 15, sold: 88,
      description: "Room for busy stores, CI runners and production databases that need steady CPU and lots of memory.",
      specs: [["CPU", "8 vCPU"], ["Memory", "32 GB RAM"], ["Storage", "320 GB SSD"], ["Transfer", "4 TB per month"], ["Network", "1 public IPv4 + IPv6"]] },
    { id: "gpu-vm", category: "vms", name: "GPU VM", icon: "🎛️", price: 1490, unit: "/mo", stock: 0, sold: 23,
      description: "A dedicated GPU for machine learning, rendering and video encoding.",
      specs: [["CPU", "16 vCPU"], ["Memory", "64 GB RAM"], ["GPU", "1 × 24 GB"], ["Storage", "500 GB NVMe"], ["Network", "1 public IPv4 + IPv6"]] },
    { id: "personal-vpn", category: "vpn", name: "Personal VPN", icon: "🔒", price: 14.9, unit: "/mo", stock: 999, sold: 1204,
      description: "For one person and their gadgets: safer public Wi-Fi and your own IP kept to yourself.",
      specs: [["Devices", "Up to 5"], ["Servers", "12 countries"], ["Logs", "No activity logs"], ["Apps", "Windows, macOS, Linux, Android, iOS"]] },
    { id: "family-vpn", category: "vpn", name: "Family VPN", icon: "👨‍👩‍👧", price: 24.9, unit: "/mo", stock: 999, sold: 430,
      description: "One plan for the whole house, with ads and trackers blocked before they load.",
      specs: [["Devices", "Up to 10"], ["Servers", "12 countries"], ["Blocking", "Ads and trackers"], ["Apps", "Windows, macOS, Linux, Android, iOS"]] },
    { id: "business-vpn", category: "vpn", name: "Business VPN", icon: "🏢", price: 29.9, unit: "/seat/mo", stock: 500, sold: 97,
      description: "Give each team member access and manage everyone from a single admin panel.",
      specs: [["Billing", "Per team member"], ["Admin", "Shared admin panel"], ["Sign-in", "Single sign-on"], ["Servers", "12 countries"]] },
    { id: "dedicated-ip", category: "addons", name: "Dedicated IP", icon: "🌐", price: 9.9, unit: "/mo", stock: 64, sold: 150,
      description: "A fixed IPv4 address that only you use, handy for allow-lists and remote access.",
      specs: [["Address", "1 dedicated IPv4"], ["Works with", "Any VM or VPN plan"], ["Reverse DNS", "Editable"]] },
    { id: "daily-backups", category: "addons", name: "Daily backups", icon: "💾", price: 7.9, unit: "/mo", stock: 999, sold: 276,
      description: "A full snapshot of your VM every night, restorable in a couple of clicks.",
      specs: [["Schedule", "Every night"], ["Kept for", "7 days"], ["Restore", "Whole VM or single files"]] },
    { id: "extra-storage", category: "addons", name: "Extra storage", icon: "📦", price: 12.9, unit: "/mo", stock: 200, sold: 181,
      description: "More disk for uploads, media and databases without moving to a bigger plan.",
      specs: [["Size", "+100 GB SSD volume"], ["Attach to", "Any VM"], ["Resize", "Anytime, no reboot"]] },
];

// VM capacity comes from the servers, never from a stock number.
const SEED_PRODUCTS = RAW_PRODUCTS.map(p => (p.category === "vms" ? { ...p, stock: 0 } : p));

// One physical host per data center, with generous resources.
const SEED_SERVERS = CATEGORIES.vms.options["Data center"].map((region, i) => ({
    id: `server-${i + 1}`, region, cpu: 32, ram: 128, storage: 2000, gpu: 0,
}));

module.exports = { SEED_PRODUCTS, SEED_SERVERS };

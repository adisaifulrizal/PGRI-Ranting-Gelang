import { OrgConfig } from '../types';
import { syncSettingsToCloud } from './sync';
import { logAuditEvent } from './auth';

export const ORG_CONFIG_STORAGE_KEY = 'org-config';

export const DEFAULT_ORG_CONFIG: OrgConfig = {
  bankName: 'Bank Jatim',
  bankAccountNumber: '0392075755',
  bankAccountHolder: 'ATIK ANDRIYATI',
  bendaharaWa: '6281515786365',
  monthlyDuesAmount: 15000,
  schools: [
    'SDN GELANG 01',
    'SDN GELANG 03',
    'SDN GELANG 04',
    'SDN GELANG 05',
    'SDN GELANG 06',
    'SDN GELANG 07',
    'SDN KALIGLAGAH 02',
    'SD NU 21 MIFTAHUL ULUM',
  ],
  kopOrganisasi: 'PERSATUAN GURU REPUBLIK INDONESIA',
  kopRanting: 'RANTING GELANG',
  kopWilayah: 'KECAMATAN SUMBERBARU - KABUPATEN JEMBER',
  kopSekretariat:
    'Sekretariat : Jl. PTPN XII Gunung Gambir Desa Gelang, Kecamatan Sumberbaru - Kabupaten Jember 68156',
  letterCodePrefix: 'PGRI.Rtg.Gelang',
  qrisImage: '',
};

export interface KepengurusanMember {
  role: string;
  name: string;
  nip: string;
  instansi: string;
  wa: string;
  gender?: 'L' | 'P';
}

export const DEFAULT_PEMBINA_MEMBER: KepengurusanMember = {
  role: 'Pengawas Bina',
  name: 'Hanifatul Susmiyah, S.Pd',
  nip: '197306022002122005',
  instansi: 'Pengawas Bina Kecamatan Sumberbaru',
  wa: '6285859083645',
  gender: 'P',
};

export const DEFAULT_PENANGGUNG_JAWAB_MEMBERS: KepengurusanMember[] = [
  {
    role: 'Ketua K3S',
    name: 'Ghufron Atok Urrohman, S.Pd',
    nip: '197805192014121003',
    instansi: 'Ketua Kelompok Kerja Kepala Sekolah',
    wa: '6285859342500',
    gender: 'L',
  },
  {
    role: 'Ketua PGRI Cabang',
    name: 'Christian Dri Firman Widodo, S.Pd',
    nip: '198012262014121002',
    instansi: 'Ketua PGRI Cabang Kecamatan Sumberbaru',
    wa: '6281217910263',
    gender: 'L',
  },
];

export const DEFAULT_PENGURUS_MEMBERS: KepengurusanMember[] = [
  { role: 'Penasehat', name: 'Semua Kepala Sekolah', nip: '-', instansi: '-', wa: '-' },
  { role: 'Ketua PGRI Ranting Gelang', name: 'Umar Ali Kusuma', nip: '198912092025211092', instansi: 'SDN GELANG 03', wa: '6288235537431', gender: 'L' },
  { role: 'Wakil Ketua', name: 'Hartatik, S.Pd', nip: '198301072022212001', instansi: 'SDN KALIGLAGAH 02', wa: '6282245380232', gender: 'P' },
  { role: 'Sekretaris', name: 'Adi Saiful Rizal, S.Pd', nip: '199401162025211089', instansi: 'SDN GELANG 03', wa: '6282292232649', gender: 'L' },
  { role: 'Bendahara', name: 'Atik Andriyati, S.Pd', nip: '197701142014122002', instansi: 'SDN GELANG 06', wa: '6281515786365', gender: 'P' },
  { role: 'Seksi Pembinaan Olahraga', name: 'Saiful Arif, S.Pd', nip: '198604122022211003', instansi: 'SDN GELANG 07', wa: '62881026888955', gender: 'L' },
  { role: 'Seksi Pemberdayaan Perempuan', name: 'Siti Oktavia, S.Pd', nip: '197910072022212001', instansi: 'SDN GELANG 04', wa: '6285697890959', gender: 'P' },
  { role: 'Seksi Pengembangan Profesi & Karir', name: 'Rohman, S.Pd', nip: '198904202022211002', instansi: 'SDN KALIGLAGAH 02', wa: '6282332910923', gender: 'L' },
  { role: 'Seksi Humas', name: 'Jasuri Budianto, S.Pd', nip: '196918082022211001', instansi: 'SDN GELANG 01', wa: '6285314904015', gender: 'L' },
  { role: 'Seksi Keagamaan', name: 'Muhammad Jupri, S.Pd.I', nip: '-', instansi: 'SD NU 21 MIFTAHUL ULUM', wa: '628817159553', gender: 'L' },
];

export const DEFAULT_KETUA_FALLBACK = DEFAULT_PENGURUS_MEMBERS[1];
export const DEFAULT_SEKRETARIS_FALLBACK = DEFAULT_PENGURUS_MEMBERS[3];

export function buildDefaultProfilCandidates() {
  const pengurus = DEFAULT_PENGURUS_MEMBERS
    .filter((p) => p.name !== '-' && !p.name.toLowerCase().startsWith('semua '))
    .map((p, idx) => ({
      id: `pengurus-${idx + 1}`,
      name: p.name,
      nip: p.nip === '-' ? '' : p.nip,
      school: p.instansi,
      phone: p.wa === '-' ? '' : p.wa,
      gender: p.gender || 'L',
      jabatanPengurus: p.role,
      kategoriProfil: 'Pengurus Ranting',
      isPengurus: true,
    }));

  const pj = DEFAULT_PENANGGUNG_JAWAB_MEMBERS.map((p, idx) => ({
    id: `pj-${idx + 1}`,
    name: p.name,
    nip: p.nip === '-' ? '' : p.nip,
    school: p.instansi,
    phone: p.wa === '-' ? '' : p.wa,
    gender: p.gender || 'L',
    jabatanPengurus: p.role,
    kategoriProfil: 'Penanggung Jawab',
    isPengurus: true,
  }));

  const pembina = {
    id: 'pembina-1',
    name: DEFAULT_PEMBINA_MEMBER.name,
    nip: DEFAULT_PEMBINA_MEMBER.nip === '-' ? '' : DEFAULT_PEMBINA_MEMBER.nip,
    school: DEFAULT_PEMBINA_MEMBER.instansi,
    phone: DEFAULT_PEMBINA_MEMBER.wa === '-' ? '' : DEFAULT_PEMBINA_MEMBER.wa,
    gender: DEFAULT_PEMBINA_MEMBER.gender || 'P',
    jabatanPengurus: DEFAULT_PEMBINA_MEMBER.role,
    kategoriProfil: 'Pembina',
    isPengurus: true,
  };

  return [...pengurus, ...pj, pembina];
}

export function getOrgConfig(): OrgConfig {
  if (typeof window === 'undefined') return DEFAULT_ORG_CONFIG;
  try {
    const raw = localStorage.getItem(ORG_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_ORG_CONFIG,
        ...parsed,
        schools:
          Array.isArray(parsed.schools) && parsed.schools.length > 0
            ? parsed.schools
            : DEFAULT_ORG_CONFIG.schools,
        monthlyDuesAmount:
          typeof parsed.monthlyDuesAmount === 'number' && !isNaN(parsed.monthlyDuesAmount)
            ? parsed.monthlyDuesAmount
            : DEFAULT_ORG_CONFIG.monthlyDuesAmount,
      };
    }
  } catch {}
  return DEFAULT_ORG_CONFIG;
}

export async function saveOrgConfig(config: OrgConfig, startPeriod?: string) {
  const sanitized: OrgConfig = {
    bankName: (config.bankName || DEFAULT_ORG_CONFIG.bankName).trim().slice(0, 80),
    bankAccountNumber: (config.bankAccountNumber || DEFAULT_ORG_CONFIG.bankAccountNumber).trim().slice(0, 50),
    bankAccountHolder: (config.bankAccountHolder || DEFAULT_ORG_CONFIG.bankAccountHolder).trim().slice(0, 120),
    bendaharaWa: (config.bendaharaWa || DEFAULT_ORG_CONFIG.bendaharaWa).replace(/[^0-9]/g, '').slice(0, 20),
    monthlyDuesAmount: Math.max(0, Number(config.monthlyDuesAmount) || 0),
    schools: Array.from(
      new Set(
        (config.schools || [])
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      )
    ),
    kopOrganisasi: (config.kopOrganisasi || DEFAULT_ORG_CONFIG.kopOrganisasi).trim().slice(0, 140),
    kopRanting: (config.kopRanting || DEFAULT_ORG_CONFIG.kopRanting).trim().slice(0, 100),
    kopWilayah: (config.kopWilayah || DEFAULT_ORG_CONFIG.kopWilayah).trim().slice(0, 140),
    kopSekretariat: (config.kopSekretariat || DEFAULT_ORG_CONFIG.kopSekretariat).trim().slice(0, 240),
    letterCodePrefix: (config.letterCodePrefix || DEFAULT_ORG_CONFIG.letterCodePrefix).trim().slice(0, 60),
    qrisImage: typeof config.qrisImage === 'string' ? config.qrisImage.trim().slice(0, 450000) : '',
  };

  const serialized = JSON.stringify(sanitized);
  const res = await syncSettingsToCloud(
    { [ORG_CONFIG_STORAGE_KEY]: serialized },
    'Konfigurasi Organisasi PGRI'
  );
  const periodNote = startPeriod ? `, periode mulai ${startPeriod}` : '';
  await logAuditEvent(
    'Pengaturan Organisasi',
    'Update Konfigurasi',
    `Memperbarui rekening kas (${sanitized.bankName}), kontribusi bulanan Rp ${sanitized.monthlyDuesAmount.toLocaleString('id-ID')}${periodNote}, dan ${sanitized.schools.length} sekolah binaan.`
  );
  return res;
}

export function openWhatsAppShare(message: string, phoneNumber?: string) {
  const cleanPhone = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : '';
  const url = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

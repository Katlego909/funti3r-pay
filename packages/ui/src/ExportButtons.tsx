import { HiOutlineArrowDownTray } from 'react-icons/hi2';

interface ExportButtonsProps {
  onCSV: () => void;
  onPDF: () => void;
  exporting?: boolean;
}

/** The CSV/PDF export pair shown in page headers. */
export default function ExportButtons({ onCSV, onPDF, exporting = false }: ExportButtonsProps) {
  return (
    <div className="export-btn-group">
      <button className="btn-export" disabled={exporting} onClick={onCSV}>
        <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'CSV'}
      </button>
      <button className="btn-export" disabled={exporting} onClick={onPDF}>
        <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'PDF'}
      </button>
    </div>
  );
}

import { HiOutlineUsers, HiOutlineBanknotes, HiOutlineClock, HiOutlineCheckCircle } from 'react-icons/hi2';
import '../styles/Dashboard.css';

export default function Dashboard() {
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <p className="subtitle">Overview of your payment operations</p>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineUsers size={20} className="metric-icon" />
            <h3>Active Users</h3>
          </div>
          <div className="metric-value">2,847</div>
          <div className="metric-change positive">↑ 12% from last month</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineBanknotes size={20} className="metric-icon" />
            <h3>Total Payments</h3>
          </div>
          <div className="metric-value">$1.2M</div>
          <div className="metric-change positive">↑ 8% from last month</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineClock size={20} className="metric-icon" />
            <h3>Pending Transactions</h3>
          </div>
          <div className="metric-value">142</div>
          <div className="metric-change neutral">No change</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineCheckCircle size={20} className="metric-icon" />
            <h3>Success Rate</h3>
          </div>
          <div className="metric-value">99.2%</div>
          <div className="metric-change positive">↑ 0.3% from last month</div>
        </div>
      </div>

      <div className="content-grid">
        <section className="section">
          <h3>Recent Transactions</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>#TXN001</td>
                <td>John Doe</td>
                <td>$5,000</td>
                <td><span className="status completed">Completed</span></td>
                <td>2026-06-01</td>
              </tr>
              <tr>
                <td>#TXN002</td>
                <td>Jane Smith</td>
                <td>$3,200</td>
                <td><span className="status completed">Completed</span></td>
                <td>2026-06-01</td>
              </tr>
              <tr>
                <td>#TXN003</td>
                <td>Mike Johnson</td>
                <td>$7,500</td>
                <td><span className="status pending">Pending</span></td>
                <td>2026-06-01</td>
              </tr>
              <tr>
                <td>#TXN004</td>
                <td>Sarah Lee</td>
                <td>$2,100</td>
                <td><span className="status completed">Completed</span></td>
                <td>2026-05-31</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="section">
          <h3>System Status</h3>
          <div className="status-list">
            <div className="status-item">
              <div className="status-dot online"></div>
              <div>
                <div className="status-name">API Gateway</div>
                <div className="status-detail">All systems operational</div>
              </div>
              <div className="status-badge">3000</div>
            </div>
            <div className="status-item">
              <div className="status-dot online"></div>
              <div>
                <div className="status-name">Payment Service</div>
                <div className="status-detail">Processing transactions</div>
              </div>
              <div className="status-badge">3002</div>
            </div>
            <div className="status-item">
              <div className="status-dot online"></div>
              <div>
                <div className="status-name">User Service</div>
                <div className="status-detail">All services running</div>
              </div>
              <div className="status-badge">3001</div>
            </div>
            <div className="status-item">
              <div className="status-dot online"></div>
              <div>
                <div className="status-name">Compliance Engine</div>
                <div className="status-detail">Active monitoring</div>
              </div>
              <div className="status-badge">3003</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

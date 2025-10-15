import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const monthlyData = [
  { month: 'January', revenue: 45000, expenses: 32000 },
  { month: 'February', revenue: 52000, expenses: 35000 },
  { month: 'March', revenue: 48000, expenses: 31000 },
  { month: 'April', revenue: 61000, expenses: 42000 },
  { month: 'May', revenue: 55000, expenses: 38000 },
  { month: 'June', revenue: 67000, expenses: 45000 }
];

const userData = [
  { month: 'January', users: 1200, activeUsers: 890 },
  { month: 'February', users: 1450, activeUsers: 1100 },
  { month: 'March', users: 1680, activeUsers: 1280 },
  { month: 'April', users: 1920, activeUsers: 1450 },
  { month: 'May', users: 2150, activeUsers: 1620 },
  { month: 'June', users: 2380, activeUsers: 1820 }
];

const Analytics = () => {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
        <h2 className="text-muted-foreground">Performance Overview</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue & Expenses</CardTitle>
          <CardDescription>Track revenue and expenses trends</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" fill="#8884d8" />
              <Bar dataKey="expenses" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>User Growth Trends</CardTitle>
          <CardDescription>Total users vs active users over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={userData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="users" stroke="#8884d8" strokeWidth={2} />
              <Line type="monotone" dataKey="activeUsers" stroke="#82ca9d" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default Analytics;

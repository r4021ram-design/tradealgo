import { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../utils/api';

export const useOrdersData = () => {
  const [pendingOrders, setPendingOrders] = useState([]);
  const [executedOrders, setExecutedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Use a ref to avoid infinite loops with setInterval
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    
    const fetchOrders = async () => {
      try {
        const response = await fetch(getApiUrl('/api/orders'));
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        
        if (result.success && result.data && isMounted.current) {
          const allOrders = result.data;
          
          // Separate orders by status
          const pending = allOrders.filter(o => o.status === 'pending');
          const executed = allOrders.filter(o => o.status !== 'pending');
          
          // Sort by submitted_at descending (newest first)
          pending.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
          executed.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
          
          setPendingOrders(pending);
          setExecutedOrders(executed);
          setError(null);
        }
      } catch (e) {
        if (isMounted.current) {
          console.error("Failed to fetch orders:", e);
          setError(e.message);
        }
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    };

    // Fetch immediately
    fetchOrders();

    // Poll every 2 seconds
    const intervalId = setInterval(fetchOrders, 2000);

    return () => {
      isMounted.current = false;
      clearInterval(intervalId);
    };
  }, []);

  const cancelOrder = async (orderId) => {
    try {
      const response = await fetch(getApiUrl(`/api/orders/${orderId}`), {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to cancel order');
      return result;
    } catch (e) {
      console.error("Cancel order error:", e);
      throw e;
    }
  };

  const modifyOrder = async (orderId, price, quantity) => {
    try {
      const response = await fetch(getApiUrl(`/api/orders/${orderId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price: parseFloat(price), quantity: parseInt(quantity, 10) }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to modify order');
      return result;
    } catch (e) {
      console.error("Modify order error:", e);
      throw e;
    }
  };

  return { 
    pendingOrders, 
    executedOrders, 
    loading, 
    error,
    cancelOrder,
    modifyOrder
  };
};

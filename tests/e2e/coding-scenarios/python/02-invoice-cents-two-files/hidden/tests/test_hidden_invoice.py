import unittest

from shop.invoice import invoice_total_cents
from shop.money import to_cents


class HiddenInvoiceTest(unittest.TestCase):
    def test_to_cents_is_exact(self):
        self.assertEqual(to_cents("19.99"), 1999)
        self.assertEqual(to_cents("0.29"), 29)
        self.assertEqual(to_cents("5.01"), 501)

    def test_discount_applies_once_to_the_total(self):
        self.assertEqual(invoice_total_cents([("19.99", 3), ("5.01", 1)], 15), 5523)

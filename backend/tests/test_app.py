import math
import tempfile
import unittest
from pathlib import Path

from app import create_app
from queueing import (
    UMBRAL_CORTE_ACUMULADA,
    ErrorValidacion,
    calcular_modelo,
    calcular_probabilidad,
)


class ModelosAnaliticosTests(unittest.TestCase):
    def test_mm1_infinito_formulas_clasicas(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_infinito", "lambda": 8, "mu": 10, "nMax": 100}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 0.8, places=6)
        self.assertAlmostEqual(r["p0"], 0.2, places=6)
        self.assertAlmostEqual(r["Ls"], 4.0, places=6)
        self.assertAlmostEqual(r["Lq"], 3.2, places=6)
        self.assertAlmostEqual(r["Ws"], 0.5, places=6)
        self.assertAlmostEqual(r["Wq"], 0.4, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 8.0, places=6)
        self.assertEqual(r["pN"], 0.0)
        distribucion = calculo["distribucion"]
        masa = sum(fila["p"] for fila in distribucion)
        self.assertGreaterEqual(masa, UMBRAL_CORTE_ACUMULADA)
        self.assertLessEqual(masa, 1.0)
        self.assertLess(len(distribucion), 101)
        self.assertGreaterEqual(
            distribucion[-1]["acumulada"], UMBRAL_CORTE_ACUMULADA
        )
        self.assertLess(distribucion[-1]["acumulada"], 1.0)
        self.assertLess(
            distribucion[-2]["acumulada"], UMBRAL_CORTE_ACUMULADA
        )

    def test_mm1_infinito_respeta_nmax_si_no_alcanza_el_umbral(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_infinito", "lambda": 9.95, "mu": 10, "nMax": 100}
        )
        distribucion = calculo["distribucion"]
        self.assertEqual(len(distribucion), 101)
        self.assertEqual(distribucion[-1]["n"], 100)
        self.assertLess(distribucion[-1]["acumulada"], UMBRAL_CORTE_ACUMULADA)

    def test_mm1_infinito_rechaza_rho_mayor_igual_uno(self):
        for lam, mu in [(10, 10), (12, 10)]:
            with self.assertRaises(ErrorValidacion):
                calcular_modelo(
                    {"modelo": "mm1_infinito", "lambda": lam, "mu": mu, "nMax": 50}
                )

    def test_mm1_finito_rho_uno(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_finito", "lambda": 2, "mu": 2, "N": 3}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 1.0, places=6)
        self.assertAlmostEqual(r["p0"], 0.25, places=6)
        self.assertAlmostEqual(r["Ls"], 1.5, places=6)
        self.assertAlmostEqual(r["Lq"], 0.75, places=6)
        self.assertAlmostEqual(r["pN"], 0.25, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 1.5, places=6)
        self.assertAlmostEqual(r["lambda_perdida"], 0.5, places=6)
        self.assertAlmostEqual(r["Ws"], 1.0, places=6)
        self.assertAlmostEqual(r["Wq"], 0.5, places=6)
        self.assertEqual(len(calculo["distribucion"]), 4)

    def test_mm1_finito_formulas_generales(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_finito", "lambda": 4, "mu": 6, "N": 2}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 4 / 6, places=6)
        self.assertAlmostEqual(r["p0"], 9 / 19, places=6)
        self.assertAlmostEqual(r["Ls"], 14 / 19, places=6)
        self.assertAlmostEqual(r["Lq"], 4 / 19, places=6)
        self.assertAlmostEqual(r["pN"], 4 / 19, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 60 / 19, places=6)
        self.assertAlmostEqual(r["lambda_perdida"], 16 / 19, places=6)
        self.assertAlmostEqual(r["Ws"], 14 / 60, places=6)
        self.assertAlmostEqual(r["Wq"], 4 / 60, places=6)

    def test_mm1_finito_corta_al_redondear_uno(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_finito", "lambda": 5, "mu": 10, "N": 50}
        )
        distribucion = calculo["distribucion"]
        self.assertLess(len(distribucion), 51)
        self.assertLess(distribucion[-1]["n"], 50)
        self.assertGreaterEqual(
            distribucion[-1]["acumulada"], UMBRAL_CORTE_ACUMULADA
        )
        self.assertLess(
            distribucion[-2]["acumulada"], UMBRAL_CORTE_ACUMULADA
        )

    def test_mm1_finito_respeta_n_si_no_alcanza_el_umbral(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_finito", "lambda": 20, "mu": 10, "N": 5}
        )
        distribucion = calculo["distribucion"]
        self.assertEqual(len(distribucion), 6)
        self.assertEqual(distribucion[-1]["n"], 5)
        self.assertEqual(distribucion[-1]["acumulada"], 1.0)

    def test_mm1_finito_admite_rho_mayor_uno_sin_nan(self):
        calculo = calcular_modelo(
            {"modelo": "mm1_finito", "lambda": 20, "mu": 10, "N": 5}
        )
        r = calculo["resultados"]
        for valor in r.values():
            self.assertTrue(math.isfinite(valor))
        self.assertAlmostEqual(
            r["lambda_efectiva"] + r["lambda_perdida"], 20.0, places=5
        )
        self.assertGreaterEqual(r["Lq"], 0)
        self.assertGreaterEqual(r["pN"], 0)
        self.assertLessEqual(r["pN"], 1)

    def test_probabilidades_infinitas(self):
        r = calcular_probabilidad(
            {
                "modelo": "mm1_infinito",
                "lambda": 8,
                "mu": 10,
                "tipo": "menor_igual",
                "k": 2,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 1 - 0.8**3, places=6)

        r = calcular_probabilidad(
            {
                "modelo": "mm1_infinito",
                "lambda": 8,
                "mu": 10,
                "tipo": "mayor_igual",
                "k": 2,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 0.8**2, places=6)

        r = calcular_probabilidad(
            {
                "modelo": "mm1_infinito",
                "lambda": 8,
                "mu": 10,
                "tipo": "rango",
                "a": 1,
                "b": 3,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 0.8 - 0.8**4, places=6)

    def test_probabilidades_finitas(self):
        r = calcular_probabilidad(
            {
                "modelo": "mm1_finito",
                "lambda": 4,
                "mu": 6,
                "N": 2,
                "tipo": "mayor_igual",
                "k": 1,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 10 / 19, places=6)

        with self.assertRaises(ErrorValidacion):
            calcular_probabilidad(
                {
                    "modelo": "mm1_finito",
                    "lambda": 4,
                    "mu": 6,
                    "N": 2,
                    "tipo": "menor_igual",
                    "k": 3,
                }
            )


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test.db"
        self.app = create_app({"TESTING": True, "DATABASE": str(self.db_path)})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_flujo_completo(self):
        respuesta = self.client.post(
            "/api/calcular",
            json={"modelo": "mm1_finito", "lambda": 4, "mu": 6, "N": 2},
        )
        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.get_json()
        self.assertTrue(datos["ok"])
        calculo = datos["calculo"]
        calculo_id = calculo["id"]
        self.assertEqual(calculo["resultados"]["pN"], 0.210526)

        historial = self.client.get("/api/historial")
        self.assertEqual(historial.status_code, 200)
        self.assertEqual(historial.get_json()["total"], 1)

        detalle = self.client.get(f"/api/calculo/{calculo_id}")
        self.assertEqual(detalle.status_code, 200)
        self.assertEqual(
            detalle.get_json()["calculo"]["distribucion"][-1]["n"], 2
        )

        eliminado = self.client.delete(f"/api/calculo/{calculo_id}")
        self.assertEqual(eliminado.status_code, 200)
        self.assertEqual(self.client.get(f"/api/calculo/{calculo_id}").status_code, 404)

    def test_errores_de_validacion(self):
        respuesta = self.client.post(
            "/api/calcular",
            json={"modelo": "mm1_infinito", "lambda": 10, "mu": 10, "nMax": 50},
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("ρ", respuesta.get_json()["error"])

        respuesta = self.client.post(
            "/api/calcular",
            json={"modelo": "mm1_finito", "lambda": 4, "mu": 6},
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(respuesta.get_json()["campo"], "N")

        respuesta = self.client.post("/api/calcular", json={})
        self.assertEqual(respuesta.status_code, 400)

    def test_probabilidad_api(self):
        respuesta = self.client.post(
            "/api/probabilidad",
            json={
                "modelo": "mm1_infinito",
                "lambda": 8,
                "mu": 10,
                "tipo": "mayor_igual",
                "k": 2,
            },
        )
        self.assertEqual(respuesta.status_code, 200)
        self.assertAlmostEqual(
            respuesta.get_json()["probabilidad"], 0.64, places=6
        )

    def test_portada_y_modulo_de_colas(self):
        portada = self.client.get("/")
        self.assertEqual(portada.status_code, 200)
        html = portada.get_data(as_text=True)
        self.assertIn("Simulab · Inicio", html)
        self.assertIn("Modelo de colas", html)
        self.assertIn('href="/modelos-de-colas"', html)

        modulo = self.client.get("/modelos-de-colas")
        self.assertEqual(modulo.status_code, 200)
        html_modulo = modulo.get_data(as_text=True)
        self.assertIn("Configura el modelo", html_modulo)
        self.assertNotIn("Elige un módulo", html_modulo)

    def test_historial_paginacion(self):
        for lam in (2, 3, 4):
            self.client.post(
                "/api/calcular",
                json={"modelo": "mm1_infinito", "lambda": lam, "mu": 10, "nMax": 10},
            )
        respuesta = self.client.get("/api/historial?limite=2&offset=0")
        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.get_json()
        self.assertEqual(len(datos["calculos"]), 2)
        self.assertEqual(datos["total"], 3)


if __name__ == "__main__":
    unittest.main()

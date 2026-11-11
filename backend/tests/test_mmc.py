import math
import tempfile
import unittest
from pathlib import Path

from app import create_app
from queueing import ErrorValidacion
from queueing_mmc import calcular_modelo_mmc, calcular_probabilidad_mmc


class ModelosMMCTests(unittest.TestCase):
    def test_mmc_infinito_formulas_clasicas(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_infinito", "lambda": 18, "mu": 10, "c": 3, "nMax": 100}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 1.8, places=6)
        self.assertAlmostEqual(r["rho_c"], 0.6, places=6)
        self.assertAlmostEqual(r["p0"], 1 / 6.85, places=6)
        self.assertAlmostEqual(r["Lq"], 0.532117, places=6)
        self.assertAlmostEqual(r["Ls"], 2.332117, places=6)
        self.assertAlmostEqual(r["Wq"], 0.029562, places=6)
        self.assertAlmostEqual(r["Ws"], 0.129562, places=6)
        self.assertAlmostEqual(r["servidores_inactivos"], 1.2, places=6)
        self.assertAlmostEqual(r["servidores_activos"], 1.8, places=6)
        self.assertAlmostEqual(r["utilizacion"], 0.6, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 18.0, places=6)
        self.assertEqual(r["lambda_perdida"], 0.0)
        self.assertEqual(r["pN"], 0.0)
        for valor in r.values():
            self.assertTrue(math.isfinite(float(valor)))

    def test_mmc_infinito_distribucion_y_nmax(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_infinito", "lambda": 18, "mu": 10, "c": 3, "nMax": 100}
        )
        distribucion = calculo["distribucion"]
        self.assertLessEqual(len(distribucion), 101)
        self.assertGreaterEqual(distribucion[-1]["acumulada"], 0.99995)
        self.assertLessEqual(distribucion[-1]["acumulada"], 1.0)
        masa = sum(fila["p"] for fila in distribucion)
        self.assertGreater(masa, 0.99)

    def test_mmc_infinito_rechaza_utilizacion_mayor_igual_uno(self):
        for lam, c in [(30, 3), (36, 3), (10, 1)]:
            with self.assertRaises(ErrorValidacion):
                calcular_modelo_mmc(
                    {
                        "modelo": "mmc_infinito",
                        "lambda": lam,
                        "mu": 10,
                        "c": c,
                        "nMax": 50,
                    }
                )

    def test_mmc_finito_caso_critico_rho_c_uno(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_finito", "lambda": 30, "mu": 10, "c": 3, "N": 6}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 3.0, places=6)
        self.assertAlmostEqual(r["rho_c"], 1.0, places=6)
        self.assertAlmostEqual(r["p0"], 1 / 26.5, places=6)
        self.assertAlmostEqual(r["Lq"], 27 / 26.5, places=6)
        self.assertAlmostEqual(r["pN"], 4.5 / 26.5, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 30 * (1 - 4.5 / 26.5), places=6)
        self.assertAlmostEqual(r["lambda_perdida"], 30 * (4.5 / 26.5), places=6)
        self.assertAlmostEqual(r["servidores_inactivos"], 13.5 / 26.5, places=6)
        self.assertAlmostEqual(
            r["servidores_activos"], 3 - 13.5 / 26.5, places=6
        )
        self.assertAlmostEqual(r["utilizacion"], (3 - 13.5 / 26.5) / 3, places=6)
        self.assertTrue(
            any("ρ/c = 1" in advertencia for advertencia in calculo["advertencias"])
        )

    def test_mmc_finito_formulas_generales(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_finito", "lambda": 18, "mu": 10, "c": 3, "N": 5}
        )
        r = calculo["resultados"]
        self.assertAlmostEqual(r["rho"], 1.8, places=6)
        self.assertAlmostEqual(r["rho_c"], 0.6, places=6)
        self.assertAlmostEqual(r["p0"], 0.1581, places=6)
        self.assertAlmostEqual(r["pN"], 0.055322, places=6)
        self.assertAlmostEqual(r["Lq"], 0.202848, places=6)
        self.assertAlmostEqual(r["lambda_efectiva"], 17.004199, places=6)
        self.assertAlmostEqual(r["lambda_perdida"], 0.995801, places=6)
        self.assertEqual(len(calculo["distribucion"]), 6)
        self.assertEqual(calculo["distribucion"][-1]["n"], 5)
        self.assertEqual(calculo["distribucion"][-1]["acumulada"], 1.0)

    def test_mmc_finito_admite_utilizacion_mayor_uno_sin_nan(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_finito", "lambda": 100, "mu": 10, "c": 3, "N": 10}
        )
        r = calculo["resultados"]
        for valor in r.values():
            self.assertTrue(math.isfinite(float(valor)))
        self.assertAlmostEqual(
            r["lambda_efectiva"] + r["lambda_perdida"], 100.0, places=5
        )
        self.assertGreaterEqual(r["Lq"], 0)
        self.assertGreaterEqual(r["pN"], 0)
        self.assertLessEqual(r["pN"], 1)
        self.assertLessEqual(r["servidores_activos"], 3)

    def test_mmc_finito_con_n_igual_c_no_tiene_cola(self):
        calculo = calcular_modelo_mmc(
            {"modelo": "mmc_finito", "lambda": 9, "mu": 5, "c": 3, "N": 3}
        )
        self.assertEqual(calculo["resultados"]["Lq"], 0.0)
        self.assertEqual(len(calculo["distribucion"]), 4)
        self.assertTrue(
            any("N = c" in advertencia for advertencia in calculo["advertencias"])
        )

    def test_probabilidades_mmc(self):
        r = calcular_probabilidad_mmc(
            {
                "modelo": "mmc_infinito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "tipo": "menor_igual",
                "k": 2,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 4.42 / 6.85, places=6)

        r = calcular_probabilidad_mmc(
            {
                "modelo": "mmc_infinito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "tipo": "mayor_igual",
                "k": 3,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 2.43 / 6.85, places=6)

        r = calcular_probabilidad_mmc(
            {
                "modelo": "mmc_finito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "N": 5,
                "tipo": "menor_igual",
                "k": 2,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 0.698801, places=6)

        r = calcular_probabilidad_mmc(
            {
                "modelo": "mmc_finito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "N": 5,
                "tipo": "rango",
                "a": 3,
                "b": 5,
            }
        )
        self.assertAlmostEqual(r["probabilidad"], 0.301199, places=6)

    def test_validaciones_mmc(self):
        with self.assertRaises(ErrorValidacion):
            calcular_modelo_mmc(
                {"modelo": "mmc_finito", "lambda": 10, "mu": 5, "c": 4, "N": 3}
            )

        with self.assertRaises(ErrorValidacion):
            calcular_modelo_mmc(
                {"modelo": "mmc_infinito", "lambda": 10, "mu": 5, "c": 0, "nMax": 50}
            )

        with self.assertRaises(ErrorValidacion):
            calcular_modelo_mmc(
                {"modelo": "mmc_infinito", "lambda": 10, "mu": 5, "c": 2.5, "nMax": 50}
            )

        with self.assertRaises(ErrorValidacion):
            calcular_probabilidad_mmc(
                {
                    "modelo": "mmc_finito",
                    "lambda": 18,
                    "mu": 10,
                    "c": 3,
                    "N": 5,
                    "tipo": "menor_igual",
                    "k": 6,
                }
            )


class ApiMMCTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test_mmc.db"
        self.app = create_app({"TESTING": True, "DATABASE": str(self.db_path)})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_flujo_completo_mmc(self):
        respuesta = self.client.post(
            "/api/calcular",
            json={
                "modelo": "mmc_finito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "N": 5,
            },
        )
        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.get_json()
        self.assertTrue(datos["ok"])
        calculo = datos["calculo"]
        self.assertEqual(calculo["modulo"], "mmc")
        self.assertEqual(calculo["parametros"]["c"], 3)
        self.assertEqual(calculo["resultados"]["pN"], 0.055322)
        calculo_id = calculo["id"]

        historial = self.client.get("/api/historial?modulo=mmc")
        self.assertEqual(historial.status_code, 200)
        self.assertEqual(historial.get_json()["total"], 1)
        self.assertEqual(historial.get_json()["calculos"][0]["id"], calculo_id)

        historial_analitico = self.client.get("/api/historial")
        self.assertEqual(historial_analitico.get_json()["total"], 0)

        detalle = self.client.get(f"/api/calculo/{calculo_id}?modulo=mmc")
        self.assertEqual(detalle.status_code, 200)
        self.assertEqual(
            detalle.get_json()["calculo"]["distribucion"][-1]["n"], 5
        )

        eliminado = self.client.delete(f"/api/calculo/{calculo_id}?modulo=mmc")
        self.assertEqual(eliminado.status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/calculo/{calculo_id}?modulo=mmc").status_code,
            404,
        )

    def test_probabilidad_api_mmc(self):
        respuesta = self.client.post(
            "/api/probabilidad",
            json={
                "modelo": "mmc_infinito",
                "lambda": 18,
                "mu": 10,
                "c": 3,
                "tipo": "menor_igual",
                "k": 2,
            },
        )
        self.assertEqual(respuesta.status_code, 200)
        self.assertAlmostEqual(
            respuesta.get_json()["probabilidad"], 4.42 / 6.85, places=6
        )

    def test_errores_de_validacion_mmc(self):
        respuesta = self.client.post(
            "/api/calcular",
            json={
                "modelo": "mmc_infinito",
                "lambda": 30,
                "mu": 10,
                "c": 3,
                "nMax": 50,
            },
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("ρ/c", respuesta.get_json()["error"])

        respuesta = self.client.post(
            "/api/calcular",
            json={
                "modelo": "mmc_finito",
                "lambda": 10,
                "mu": 5,
                "c": 4,
                "N": 3,
            },
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(respuesta.get_json()["campo"], "N")

    def test_pagina_mmc(self):
        pagina = self.client.get("/modelos-de-colas/mmc")
        self.assertEqual(pagina.status_code, 200)
        html = pagina.get_data(as_text=True)
        self.assertIn("Configura el modelo", html)
        self.assertIn("M/M/c", html)
        self.assertIn('data-bs-target="#guiaMMC"', html)

    def test_modulo_invalido_en_historial(self):
        respuesta = self.client.get("/api/historial?modulo=otro")
        self.assertEqual(respuesta.status_code, 400)


if __name__ == "__main__":
    unittest.main()
